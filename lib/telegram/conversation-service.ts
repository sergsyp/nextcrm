import { prismadb } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { getAiAgentDefinition } from "@/lib/ai-team/definitions";
import { VZJUH_BOT_ACCOUNT } from "./vzjuh";

export async function saveIncomingVzjuhMessage(input: {
  chatId: bigint;
  messageId: bigint;
  senderId: bigint;
  username?: string;
  displayName?: string;
  text: string;
  sentAt: Date;
}) {
  const conversation = await prismadb.crm_TelegramConversation.upsert({
    where: { botAccount_chatId: { botAccount: VZJUH_BOT_ACCOUNT, chatId: input.chatId } },
    update: { username: input.username, displayName: input.displayName, status: "ACTIVE" },
    create: {
      botAccount: VZJUH_BOT_ACCOUNT,
      chatId: input.chatId,
      username: input.username,
      displayName: input.displayName,
    },
  });
  const duplicate = await prismadb.crm_TelegramMessage.findUnique({
    where: {
      conversationId_telegramMessageId_direction: {
        conversationId: conversation.id,
        telegramMessageId: input.messageId,
        direction: "INBOUND",
      },
    },
  });
  if (duplicate) return { conversation, message: duplicate, duplicate: true };
  const message = await prismadb.crm_TelegramMessage.create({
    data: {
      conversationId: conversation.id,
      telegramMessageId: input.messageId,
      direction: "INBOUND",
      senderId: input.senderId,
      text: input.text,
      sentAt: input.sentAt,
    },
  });
  const salesDefinition = getAiAgentDefinition("sales")!;
  const sales = await prismadb.users.findUnique({ where: { email: salesDefinition.email }, select: { id: true } });
  if (!sales) throw new Error("AI_SALES_USER_NOT_CONFIGURED");
  let board = await prismadb.boards.findFirst({
    where: { title: "Telegram — входящие обращения «Вжух»", user: sales.id, deletedAt: null },
    include: { sections: true },
  });
  if (!board) {
    board = await prismadb.boards.create({
      data: {
        v: 0,
        title: "Telegram — входящие обращения «Вжух»",
        description: "Событийная очередь клиентских диалогов @vzjuh_bot. Канал ведёт Марк Ветров по общему регламенту коммерческой переписки.",
        icon: "MessageCircle",
        visibility: "shared",
        user: sales.id,
        createdBy: sales.id,
        updatedBy: sales.id,
        sharedWith: [sales.id],
        sections: { create: [{ v: 0, title: "Тест продаж", position: BigInt(1000) }] },
      },
      include: { sections: true },
    });
  }
  const section = board.sections.find((item) => item.title === "Тест продаж");
  if (!section) throw new Error("TELEGRAM_SALES_SECTION_NOT_CONFIGURED");
  const maxPosition = await prismadb.tasks.aggregate({ where: { section: section.id }, _max: { position: true } });
  const task = await prismadb.tasks.create({
    data: {
      v: 0,
      title: `Марк: ответить в Telegram — ${input.displayName || input.username || input.chatId}`,
      content: `Получено новое сообщение клиента в @vzjuh_bot. Прочитай весь диалог через crm_get_telegram_conversation и ответь через crm_send_telegram_message так же содержательно, как в email, но короче. Conversation ID: ${conversation.id}. Message ID: ${message.id}.`,
      position: (maxPosition._max.position ?? BigInt(0)) + BigInt(1000),
      priority: "High",
      section: section.id,
      user: sales.id,
      createdBy: sales.id,
      updatedBy: sales.id,
      dueDateAt: new Date(Date.now() + 15 * 60 * 1000),
      tags: { kind: "telegram-customer-message", agent: "sales", conversationId: conversation.id, telegramMessageId: input.messageId.toString() },
    },
  });
  await inngest.send({ name: "ai-team/task.run", data: { agent: "sales", taskId: task.id } });
  return { conversation, message, task, duplicate: false };
}
