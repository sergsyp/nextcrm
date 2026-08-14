import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { callVzjuhTelegram, VZJUH_BOT_ACCOUNT } from "@/lib/telegram/vzjuh";
import { requestSergeyApproval } from "@/lib/telegram/approval-service";

type SentMessage = { message_id: number; date: number };

export const crmTelegramTools = [
  {
    name: "crm_get_telegram_conversation",
    description: "Get one @vzjuh_bot customer conversation with its ordered message history",
    schema: z.object({ conversationId: z.string().uuid() }),
    async handler(args: { conversationId: string }) {
      const data = await prismadb.crm_TelegramConversation.findUnique({
        where: { id: args.conversationId },
        include: { messages: { orderBy: { sentAt: "asc" }, take: 100 } },
      });
      if (!data || data.botAccount !== VZJUH_BOT_ACCOUNT) throw new Error("NOT_FOUND");
      return { data };
    },
  },
  {
    name: "crm_send_telegram_message",
    description: "Send a reply in an existing @vzjuh_bot customer conversation and save delivery proof in CRM",
    schema: z.object({ conversationId: z.string().uuid(), text: z.string().min(1).max(4096) }),
    async handler(args: { conversationId: string; text: string }, userId: string) {
      const conversation = await prismadb.crm_TelegramConversation.findUnique({ where: { id: args.conversationId } });
      if (!conversation || conversation.botAccount !== VZJUH_BOT_ACCOUNT || conversation.chatKind !== "CUSTOMER") throw new Error("NOT_FOUND");
      const sent = await callVzjuhTelegram<SentMessage>("sendMessage", {
        chat_id: conversation.chatId.toString(), text: args.text,
      });
      const message = await prismadb.crm_TelegramMessage.create({
        data: {
          conversationId: conversation.id,
          telegramMessageId: BigInt(sent.message_id),
          direction: "OUTBOUND",
          text: args.text,
          sentAt: new Date(sent.date * 1000),
          metadata: { crmUserId: userId },
        },
      });
      return { data: message };
    },
  },
  {
    name: "crm_request_sergey_approval",
    description: "Create a durable CRM approval request and immediately notify Sergey through @vzjuh_bot with one-time buttons",
    schema: z.object({
      kind: z.enum(["FIRST_MESSAGE", "LANDING_PUBLISH", "PRICE_OR_DISCOUNT", "CONTRACT_COMMITMENT", "SCALE"]),
      title: z.string().min(1).max(300),
      summary: z.string().min(1).max(3000),
      taskId: z.string().uuid(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
    async handler(args: { kind: "FIRST_MESSAGE" | "LANDING_PUBLISH" | "PRICE_OR_DISCOUNT" | "CONTRACT_COMMITMENT" | "SCALE"; title: string; summary: string; taskId: string; details?: Record<string, unknown> }, userId: string) {
      const task = await prismadb.tasks.findFirst({ where: { id: args.taskId, user: userId }, select: { id: true } });
      if (!task) throw new Error("NOT_FOUND");
      const data = await requestSergeyApproval({ ...args, requestedByAgent: "sales" });
      return { data };
    },
  },
];
