import { prismadb } from "@/lib/prisma";
import { getAiAgentDefinition } from "./definitions";

const MOSCOW_TIME_ZONE = "Europe/Moscow";

function moscowDay(now: Date): { key: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { key: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}

export async function ensureDailyAutonomousQueue(now = new Date()) {
  const { key, weekday } = moscowDay(now);
  if (["Sat", "Sun"].includes(weekday)) return { skipped: true, reason: "non-working day" };

  const researcher = getAiAgentDefinition("researcher")!;
  const researcherUser = await prismadb.users.findUnique({
    where: { email: researcher.email }, select: { id: true },
  });
  if (!researcherUser) return { skipped: true, reason: "researcher is not configured" };

  const boardTitle = process.env.AI_TEAM_AUTONOMY_BOARD ?? "Металлообработка — проверка гипотезы";
  const board = await prismadb.boards.findFirst({
    where: { title: boardTitle, deletedAt: null },
    include: { sections: { where: { title: "Исследование" }, take: 1 } },
  });
  const section = board?.sections[0];
  if (!board || !section) return { skipped: true, reason: "autonomy board/section is not configured" };

  const dailyKey = `autonomy-prospecting:${board.id}:${key}`;
  const existing = await prismadb.tasks.findFirst({
    where: { section: section.id, tags: { path: ["dailyKey"], equals: dailyKey } },
    select: { id: true },
  });
  if (existing) return { skipped: true, reason: "daily queue already exists", taskId: existing.id };

  const quota = Math.max(1, Math.min(50, Number(process.env.AI_TEAM_DAILY_PROSPECT_QUOTA ?? 5)));
  const maxPosition = await prismadb.tasks.aggregate({
    where: { section: section.id }, _max: { position: true },
  });
  const task = await prismadb.tasks.create({
    data: {
      v: 0,
      title: `Алиса: ежедневный пул потенциальных клиентов — ${key}`,
      content: [
        `Самостоятельно найти минимум ${quota} новых B2B-компаний, соответствующих действующему ICP доски «${boardTitle}».`,
        "Использовать crm_web_search и только публичные проверяемые источники. Для каждой компании сохранить URL и дату проверки.",
        "Проверить дубли, do_not_email, существующие контакты и недавние касания. Создать Target только при достаточных данных и добавить в целевой список доски.",
        "После завершения создать и назначить Марку задачу в секции «Подготовка предложения» с Target ID и источниками.",
        "Не запрашивать вмешательство Сергея или Василия. При устранимой ошибке повторить безопасно; эскалировать Роману только неустранимый BLOCKER.",
      ].join("\n"),
      position: (maxPosition._max.position ?? BigInt(0)) + BigInt(1000),
      priority: "High",
      section: section.id,
      user: researcherUser.id,
      createdBy: researcherUser.id,
      updatedBy: researcherUser.id,
      dueDateAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      tags: { kind: "autonomous-daily-prospecting", agent: "researcher", dailyKey, quota, boardId: board.id },
    },
    select: { id: true },
  });
  return { created: true, taskId: task.id, quota };
}

export async function recoverRateLimitedTasks(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const candidates = await prismadb.tasks.findMany({
    where: {
      taskStatus: "ACTIVE",
      tags: { path: ["aiRunStatus"], equals: "blocked" },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, tags: true }, take: 25,
  });
  let recovered = 0;
  for (const task of candidates) {
    const tags = task.tags && typeof task.tags === "object" && !Array.isArray(task.tags)
      ? task.tags as Record<string, unknown> : {};
    if (!String(tags.aiRunError ?? "").includes("429")) continue;
    const cycles = Number(tags.aiRecoveryCycles ?? 0);
    if (cycles >= 3) continue;
    await prismadb.tasks.update({
      where: { id: task.id },
      data: { tags: { ...tags, aiRunStatus: "failed", aiRunFailures: 0, aiRecoveryCycles: cycles + 1, aiRecoveredAt: now.toISOString() } },
    });
    recovered += 1;
  }
  return { recovered };
}
