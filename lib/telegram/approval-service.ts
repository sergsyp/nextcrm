import { prismadb } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import type { Prisma } from "@prisma/client";
import { logPipelineEvent } from "@/lib/ai-team/observability";
import {
  approvalCallbackData,
  callVzjuhTelegram,
  vzjuhAdminChatId,
} from "./vzjuh";

const APPROVAL_COMMENT: Record<string, string> = {
  FIRST_MESSAGE: "APPROVED:FIRST_MESSAGE",
  LANDING_PUBLISH: "APPROVED:LANDING_PUBLISH",
  PRICE_OR_DISCOUNT: "APPROVED:PRICE_OR_DISCOUNT",
  CONTRACT_COMMITMENT: "APPROVED:CONTRACT_COMMITMENT",
  SCALE: "APPROVED:SCALE",
};

type TelegramMessage = { message_id: number };

export async function requestSergeyApproval(input: {
  kind: keyof typeof APPROVAL_COMMENT;
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  taskId: string;
  requestedByAgent: string;
}) {
  const dedupeKey = `${input.taskId}:${input.kind}`;
  const existing = await prismadb.ai_ApprovalRequest.findUnique({ where: { dedupeKey } });
  if (existing?.status === "PENDING" || existing?.status === "APPROVED") return existing;
  if (existing) {
    await prismadb.ai_ApprovalRequest.update({
      where: { id: existing.id },
      data: { dedupeKey: null },
    });
  }

  const chatId = vzjuhAdminChatId();
  const approval = await prismadb.ai_ApprovalRequest.create({
    data: {
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      details: input.details as Prisma.InputJsonValue | undefined,
      taskId: input.taskId,
      requestedByAgent: input.requestedByAgent,
      dedupeKey,
      telegramChatId: chatId,
    },
  });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://sm.a-vjuh.ru").replace(/\/$/, "");
  try {
    const sent = await callVzjuhTelegram<TelegramMessage>("sendMessage", {
      chat_id: chatId.toString(),
      text: [
        "🔔 Требуется решение Сергея",
        "",
        input.title,
        input.summary,
        "",
        `Запрос: ${approval.id}`,
      ].join("\n").slice(0, 4096),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Одобрить", callback_data: approvalCallbackData(approval.id, "approve") },
            { text: "❌ Отклонить", callback_data: approvalCallbackData(approval.id, "reject") },
          ],
          [{ text: "👁 Открыть задачу", url: `${appUrl}/ru/projects/tasks/viewtask/${input.taskId}` }],
        ],
      },
    });
    const updated = await prismadb.ai_ApprovalRequest.update({
      where: { id: approval.id },
      data: { telegramMessageId: BigInt(sent.message_id) },
    });
    await logPipelineEvent({
      eventType: "APPROVAL_REQUEST_DELIVERED",
      message: `${input.requestedByAgent}: запрос решения доставлен Сергею через @vzjuh_bot`,
      agentKey: input.requestedByAgent,
      taskId: input.taskId,
      metadata: { approvalRequestId: approval.id, kind: input.kind },
    });
    return updated;
  } catch (error) {
    await prismadb.ai_ApprovalRequest.delete({ where: { id: approval.id } });
    throw error;
  }
}

export async function sendApprovalReminders(now = new Date()) {
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const pending = await prismadb.ai_ApprovalRequest.findMany({
    where: {
      status: "PENDING",
      OR: [
        { reminderCount: 0, createdAt: { lte: fourHoursAgo } },
        { reminderCount: 1, createdAt: { lte: dayAgo } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let sent = 0;
  for (const approval of pending) {
    await callVzjuhTelegram<TelegramMessage>("sendMessage", {
      chat_id: vzjuhAdminChatId().toString(),
      text: [
        approval.reminderCount === 0 ? "⏰ Напоминание: требуется решение" : "⚠️ Процесс всё ещё ожидает решения",
        "",
        approval.title,
        approval.summary,
      ].join("\n").slice(0, 4096),
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Одобрить", callback_data: approvalCallbackData(approval.id, "approve") },
          { text: "❌ Отклонить", callback_data: approvalCallbackData(approval.id, "reject") },
        ]],
      },
    });
    await prismadb.ai_ApprovalRequest.update({
      where: { id: approval.id },
      data: { reminderCount: { increment: 1 }, lastRemindedAt: now },
    });
    sent += 1;
  }
  return { sent };
}

export async function decideSergeyApproval(input: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  telegramUserId: bigint;
}) {
  if (input.telegramUserId !== vzjuhAdminChatId()) throw new Error("FORBIDDEN");
  const admin = await prismadb.users.findFirst({
    where: { role: "admin", userStatus: "ACTIVE" },
    orderBy: { created_on: "asc" },
    select: { id: true },
  });
  if (!admin) throw new Error("CRM_ADMIN_NOT_CONFIGURED");

  const current = await prismadb.ai_ApprovalRequest.findUnique({ where: { id: input.id } });
  if (!current) throw new Error("NOT_FOUND");
  if (current.status !== "PENDING") return { approval: current, changed: false, taskId: current.taskId };

  const comment = input.decision === "APPROVED"
    ? APPROVAL_COMMENT[current.kind] ?? `APPROVED:${current.kind}`
    : `REJECTED:${current.kind}`;
  const result = await prismadb.$transaction(async (tx) => {
    const approval = await tx.ai_ApprovalRequest.update({
      where: { id: current.id },
      data: { status: input.decision, decidedByUserId: admin.id, decidedAt: new Date() },
    });
    if (current.taskId) {
      await tx.tasksComments.create({ data: { v: 0, task: current.taskId, user: admin.id, comment } });
      const task = await tx.tasks.findUnique({ where: { id: current.taskId }, select: { tags: true } });
      const tags = task?.tags && typeof task.tags === "object" && !Array.isArray(task.tags)
        ? task.tags as Record<string, unknown> : {};
      await tx.tasks.update({
        where: { id: current.taskId },
        data: {
          taskStatus: "ACTIVE",
          tags: { ...tags, aiRunStatus: "failed", approvalStatus: input.decision, approvalRequestId: current.id },
        },
      });
    }
    return approval;
  });
  await logPipelineEvent({
    eventType: "APPROVAL_REQUEST_DECIDED",
    level: input.decision === "APPROVED" ? "INFO" : "WARNING",
    message: `Сергей ${input.decision === "APPROVED" ? "одобрил" : "отклонил"} запрос через @vzjuh_bot`,
    agentKey: current.requestedByAgent,
    taskId: current.taskId ?? undefined,
    metadata: { approvalRequestId: current.id, kind: current.kind, decision: input.decision },
  });
  return { approval: result, changed: true, taskId: current.taskId };
}

export async function dispatchApprovalResume(input: {
  id: string;
  taskId: string | null;
  resumeDispatchedAt: Date | null;
}) {
  if (!input.taskId || input.resumeDispatchedAt) return { dispatched: false };

  await inngest.send({
    name: "ai-team/task.run",
    data: { agent: "sales", taskId: input.taskId },
  });
  await prismadb.ai_ApprovalRequest.update({
    where: { id: input.id },
    data: { resumeDispatchedAt: new Date() },
  });
  return { dispatched: true };
}
