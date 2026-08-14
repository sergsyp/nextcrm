import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { decideSergeyApproval } from "@/lib/telegram/approval-service";
import { saveIncomingVzjuhMessage } from "@/lib/telegram/conversation-service";
import {
  callVzjuhTelegram,
  parseApprovalCallback,
  verifyVzjuhWebhookSecret,
  vzjuhAdminChatId,
} from "@/lib/telegram/vzjuh";

type TelegramUpdate = {
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number }; text?: string };
  };
};

async function bestEffortTelegram(method: string, params: Record<string, unknown>) {
  try {
    await callVzjuhTelegram(method, params);
  } catch (error) {
    console.error("[vzjuh-telegram] callback acknowledgement failed", { method, error });
  }
}

export async function POST(request: NextRequest) {
  if (!verifyVzjuhWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await request.json() as TelegramUpdate;
  const callback = update.callback_query;
  if (callback?.data) {
    const parsed = parseApprovalCallback(callback.data);
    if (!parsed) {
      await bestEffortTelegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Неизвестное действие" });
      return NextResponse.json({ ok: true });
    }
    if (BigInt(callback.from.id) !== vzjuhAdminChatId()) {
      await bestEffortTelegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Недостаточно прав", show_alert: true });
      return NextResponse.json({ ok: true });
    }
    const result = await decideSergeyApproval({
      id: parsed.id,
      decision: parsed.decision,
      telegramUserId: BigInt(callback.from.id),
    });
    const label = result.approval.status === "APPROVED" ? "✅ Одобрено Сергеем" : "❌ Отклонено Сергеем";
    await bestEffortTelegram("answerCallbackQuery", { callback_query_id: callback.id, text: label });
    if (callback.message) {
      await bestEffortTelegram("editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: `${callback.message.text ?? result.approval.title}\n\n${label}`.slice(0, 4096),
      });
    }
    if (result.changed && result.taskId) {
      await inngest.send({ name: "ai-team/task.run", data: { agent: "sales", taskId: result.taskId } });
    }
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text || !message.from || message.chat.type !== "private") {
    return NextResponse.json({ ok: true });
  }
  if (BigInt(message.from.id) === vzjuhAdminChatId()) {
    return NextResponse.json({ ok: true });
  }
  await saveIncomingVzjuhMessage({
    chatId: BigInt(message.chat.id),
    messageId: BigInt(message.message_id),
    senderId: BigInt(message.from.id),
    username: message.from.username,
    displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || undefined,
    text: message.text,
    sentAt: new Date(message.date * 1000),
  });
  return NextResponse.json({ ok: true });
}
