import { prismadb } from "@/lib/prisma";
import { AI_AGENT_DEFINITIONS } from "./definitions";
import {
  upsertAgentKnowledgeDocument,
  upsertTeamKnowledgeDocument,
} from "./knowledge";
import { AI_TEAM_KNOWLEDGE } from "./team-knowledge";
import type { AiAgentKey, AiTeamSetupResult } from "./types";

export const IDEA_BOARD_SECTIONS = [
  "Входящие идеи",
  "Исследование",
  "Ожидает подтверждения",
  "Подготовка предложения",
  "Проверка",
  "Готово к тесту",
  "Тест продаж",
  "Масштабирование",
  "Закрыто",
] as const;

export async function ensureAiTeam(ownerUserId: string): Promise<AiTeamSetupResult> {
  const users = {} as Record<AiAgentKey, string>;
  const knowledgeDocumentIds: string[] = [];

  for (const document of AI_TEAM_KNOWLEDGE) {
    knowledgeDocumentIds.push(
      await upsertTeamKnowledgeDocument(document, ownerUserId)
    );
  }

  for (const agent of AI_AGENT_DEFINITIONS) {
    const user = await prismadb.users.upsert({
      where: { email: agent.email },
      update: {
        name: agent.name,
        role: agent.crmRole,
        userStatus: "ACTIVE",
        userLanguage: "ru",
      },
      create: {
        email: agent.email,
        emailVerified: true,
        name: agent.name,
        role: agent.crmRole,
        userStatus: "ACTIVE",
        userLanguage: "ru",
      },
    });
    users[agent.key] = user.id;
    knowledgeDocumentIds.push(await upsertAgentKnowledgeDocument(agent, user.id));
  }

  let board = await prismadb.boards.findFirst({
    where: {
      title: "Шаблон коммерческой идеи",
      createdBy: ownerUserId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!board) {
    board = await prismadb.boards.create({
      data: {
        v: 0,
        title: "Шаблон коммерческой идеи",
        description:
          "Скопируйте доску для новой идеи. Агенты работают через секции, задачи, комментарии и документы.",
        icon: "Lightbulb",
        visibility: "shared",
        user: ownerUserId,
        createdBy: ownerUserId,
        updatedBy: ownerUserId,
        sharedWith: Object.values(users),
        sections: {
          create: IDEA_BOARD_SECTIONS.map((title, index) => ({
            v: 0,
            title,
            position: BigInt((index + 1) * 1000),
          })),
        },
      },
      select: { id: true },
    });
  } else {
    await prismadb.boards.update({
      where: { id: board.id },
      data: { sharedWith: Object.values(users), updatedBy: ownerUserId },
    });
    const existingSections = await prismadb.sections.findMany({
      where: { board: board.id },
      select: { title: true },
    });
    const existingTitles = new Set(existingSections.map((section) => section.title));
    for (let i = 0; i < IDEA_BOARD_SECTIONS.length; i += 1) {
      const title = IDEA_BOARD_SECTIONS[i];
      if (!existingTitles.has(title)) {
        await prismadb.sections.create({
          data: {
            v: 0,
            board: board.id,
            title,
            position: BigInt((i + 1) * 1000),
          },
        });
      }
    }
  }

  const intakeSection = await prismadb.sections.findFirstOrThrow({
    where: { board: board.id, title: "Входящие идеи" },
    select: { id: true },
  });
  const starterTask = await prismadb.tasks.findFirst({
    where: {
      section: intakeSection.id,
      title: "Как создать новую коммерческую гипотезу",
    },
    select: { id: true },
  });
  if (!starterTask) {
    await prismadb.tasks.create({
      data: {
        v: 0,
        title: "Как создать новую коммерческую гипотезу",
        content:
          "Скопируйте эту доску, заполните паспорт гипотезы в описании и назначьте первую исследовательскую задачу AI Исследователю.",
        position: BigInt(1000),
        priority: "medium",
        section: intakeSection.id,
        user: users.researcher,
        createdBy: ownerUserId,
        updatedBy: ownerUserId,
        tags: {
          kind: "ai-team-template-instruction",
          agent: "researcher",
        },
      },
    });
  }

  return { users, knowledgeDocumentIds, templateBoardId: board.id };
}
