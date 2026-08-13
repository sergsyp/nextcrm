import { prismadb } from "@/lib/prisma";
import { getAiAgentDefinition } from "./definitions";
import { logPipelineEvent, reportIncident } from "./observability";

const MOSCOW_TIME_ZONE = "Europe/Moscow";

type DirectionConfig = {
  key: string;
  boardTitle: string;
  quota: number;
  taskBrief: string;
};

function findSection<T extends { title: string }>(
  sections: T[],
  titles: readonly string[]
): T | undefined {
  return sections.find((section) => titles.includes(section.title));
}

const DEFAULT_DIRECTIONS: DirectionConfig[] = [
  {
    key: "metalworking",
    boardTitle: "Металлообработка — проверка гипотезы",
    quota: 5,
    taskBrief: "новые B2B-заказчики услуг металлообработки",
  },
  {
    key: "hvac",
    boardTitle: "Вентиляция, отопление и кондиционирование — автономные продажи",
    quota: 5,
    taskBrief: "новые B2B-заказчики промышленной вентиляции, отопления и кондиционирования",
  },
];

function moscowParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    hour: Number(get("hour")),
  };
}

async function loadDirections(): Promise<DirectionConfig[]> {
  const setting = await prismadb.crm_SystemSettings.findUnique({ where: { key: "ai-team.prospecting.config" } });
  if (!setting) return DEFAULT_DIRECTIONS;
  try {
    const parsed = JSON.parse(setting.value) as { directions?: DirectionConfig[] };
    return parsed.directions?.length ? parsed.directions : DEFAULT_DIRECTIONS;
  } catch {
    await logPipelineEvent({
      eventType: "PROSPECTING_CONFIG_INVALID",
      level: "ERROR",
      message: "Настройка ai-team.prospecting.config содержит некорректный JSON; применены безопасные значения по умолчанию",
    });
    return DEFAULT_DIRECTIONS;
  }
}

async function getAgentUser(key: "researcher" | "sales" | "controller") {
  const definition = getAiAgentDefinition(key)!;
  return prismadb.users.findUnique({ where: { email: definition.email }, select: { id: true } });
}

async function createProspectingAttempt(config: DirectionConfig, businessDate: string, attempt: number, now: Date) {
  const board = await prismadb.boards.findFirst({
    where: { title: config.boardTitle, deletedAt: null },
    include: { sections: true },
  });
  const section = board?.sections.find((item) => item.title === "Исследование");
  const researcher = await getAgentUser("researcher");
  if (!board || !section || !researcher) {
    await reportIncident({
      code: "PROSPECTING_CONFIGURATION_MISSING",
      title: `Ночной поиск не настроен: ${config.key}`,
      severity: "BLOCKER",
      direction: config.key,
      stage: "scheduler",
      owner: "Роман Ястребов",
      details: { boardFound: Boolean(board), sectionFound: Boolean(section), researcherFound: Boolean(researcher) },
    });
    return { skipped: true, reason: "configuration missing" };
  }

  const dayStart = new Date(`${businessDate}T00:00:00+03:00`);
  const dayEnd = new Date(`${businessDate}T23:59:59.999+03:00`);
  const directionTag = `direction:${config.key}`;
  const acceptedToday = await prismadb.crm_Targets.count({
    where: { deletedAt: null, created_on: { gte: dayStart, lte: dayEnd }, tags: { has: directionTag } },
  });
  const missing = Math.max(0, config.quota - acceptedToday);
  if (missing === 0) {
    await logPipelineEvent({
      eventType: "DAILY_QUOTA_REACHED",
      message: `${config.key}: дневная квота ${config.quota} выполнена`,
      direction: config.key,
      stage: "research",
      metadata: { quota: config.quota, acceptedToday },
    });
    return { skipped: true, reason: "quota reached", acceptedToday };
  }

  const cycleKey = `${businessDate}:${config.key}:${attempt}`;
  const existing = await prismadb.ai_ProspectingCycle.findUnique({ where: { cycleKey } });
  if (existing) return { skipped: true, reason: "attempt exists", cycleId: existing.id };

  const cycle = await prismadb.ai_ProspectingCycle.create({
    data: {
      cycleKey, businessDate, direction: config.key, boardId: board.id,
      quota: missing, attempt, status: "SCHEDULED",
      metadata: { dailyQuota: config.quota, acceptedBefore: acceptedToday },
    },
  });
  const maxPosition = await prismadb.tasks.aggregate({ where: { section: section.id }, _max: { position: true } });
  const task = await prismadb.tasks.create({
    data: {
      v: 0,
      title: `Алиса: ночной поиск — ${config.key} — ${businessDate} — попытка ${attempt}`,
      content: [
        `Самостоятельно найти ${missing} ${config.taskBrief}.`,
        "Перед поиском прочитать канонический регламент своей роли, общий operating model и документы ICP этой доски.",
        "Для каждого кандидата проверить публичный источник, дату, соответствие ICP, дубли, do_not_email и прежние касания.",
        `Создавать Target только через штатный CRM-инструмент; обязательно добавить теги «${directionTag}» и «cycle:${cycle.id}».`,
        "В карточке сохранить URL источника, дату проверки, факты, допущения и краткое обоснование соответствия.",
        "Не создавать задачи следующему агенту: штатную передачу после измеримого результата выполнит код.",
        "Клиентам ночью не писать. В итоговом ответе указать числа CREATED, DUPLICATE, REJECTED и причину недобора.",
      ].join("\n"),
      position: (maxPosition._max.position ?? BigInt(0)) + BigInt(1000),
      priority: "High",
      section: section.id,
      user: researcher.id,
      createdBy: researcher.id,
      updatedBy: researcher.id,
      dueDateAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      tags: {
        kind: "nightly-prospecting", agent: "researcher", direction: config.key,
        prospectingCycleId: cycle.id, quota: missing, businessDate, attempt,
      },
    },
  });
  await prismadb.ai_ProspectingCycle.update({
    where: { id: cycle.id }, data: { taskId: task.id, status: "RUNNING", startedAt: now },
  });
  await logPipelineEvent({
    eventType: "PROSPECTING_CYCLE_STARTED",
    message: `${config.key}: Алисе назначен ночной поиск ${missing} новых компаний`,
    direction: config.key, stage: "research", cycleId: cycle.id, taskId: task.id,
    agentKey: "researcher", metadata: { dailyQuota: config.quota, missing, attempt },
  });
  return { created: true, cycleId: cycle.id, taskId: task.id, missing };
}

export async function ensureNightlyProspecting(now = new Date()) {
  const { date, weekday, hour } = moscowParts(now);
  if (["Sat", "Sun"].includes(weekday)) return { skipped: true, reason: "non-working day" };
  const attemptByHour: Record<number, number> = { 1: 1, 4: 2, 6: 3 };
  const attempt = attemptByHour[hour];
  if (!attempt) return { skipped: true, reason: "outside nightly checkpoints" };
  const results = [];
  for (const config of await loadDirections()) results.push(await createProspectingAttempt(config, date, attempt, now));
  return { businessDate: date, attempt, results };
}

export async function reconcileProspectingPipeline(now = new Date()) {
  const cycles = await prismadb.ai_ProspectingCycle.findMany({
    where: { status: { in: ["RUNNING", "PARTIAL"] }, taskId: { not: null } }, take: 25,
  });
  const controller = await getAgentUser("controller");
  const sales = await getAgentUser("sales");
  let reconciled = 0;
  for (const cycle of cycles) {
    const task = await prismadb.tasks.findUnique({ where: { id: cycle.taskId! }, select: { tags: true } });
    const tags = task?.tags && typeof task.tags === "object" && !Array.isArray(task.tags)
      ? task.tags as Record<string, unknown> : {};
    if (!["completed", "failed", "blocked"].includes(String(tags.aiRunStatus ?? ""))) continue;
    const targets = await prismadb.crm_Targets.findMany({
      where: { deletedAt: null, tags: { has: `cycle:${cycle.id}` } }, select: { id: true },
    });
    const acceptedCount = targets.length;
    const status = acceptedCount >= cycle.quota ? "COMPLETED" : acceptedCount > 0 ? "PARTIAL" : "FAILED";
    await prismadb.ai_ProspectingCycle.update({
      where: { id: cycle.id }, data: { acceptedCount, status, completedAt: now },
    });
    await logPipelineEvent({
      eventType: "PROSPECTING_CYCLE_COMPLETED",
      level: status === "COMPLETED" ? "INFO" : "WARNING",
      message: `${cycle.direction}: найдено ${acceptedCount} из ${cycle.quota}`,
      direction: cycle.direction, stage: "research", cycleId: cycle.id, taskId: cycle.taskId!,
      metadata: { quota: cycle.quota, acceptedCount, status },
    });
    if (acceptedCount === 0 || !controller) {
      if (cycle.attempt >= 3) await reportIncident({
        code: "DAILY_PROSPECTING_QUOTA_MISSED",
        title: `${cycle.direction}: ночной поиск не дал новых Target`,
        severity: "ERROR", direction: cycle.direction, stage: "research", cycleId: cycle.id,
        taskId: cycle.taskId!, owner: "Роман Ястребов", details: { quota: cycle.quota, acceptedCount },
      });
      continue;
    }
    const board = await prismadb.boards.findUnique({ where: { id: cycle.boardId }, include: { sections: true } });
    const reviewSection = board
      ? findSection(board.sections, ["Проверка", "На проверке"])
      : undefined;
    if (!reviewSection) {
      await reportIncident({
        code: "PIPELINE_REVIEW_SECTION_MISSING",
        title: `${cycle.direction}: отсутствует этап проверки кандидатов`,
        severity: "BLOCKER",
        direction: cycle.direction,
        stage: "handoff",
        cycleId: cycle.id,
        taskId: cycle.taskId!,
        owner: "Роман Ястребов",
        details: { expectedSections: ["Проверка", "На проверке"] },
      });
      continue;
    }
    const existingReview = await prismadb.tasks.findFirst({
      where: { tags: { path: ["sourceCycleId"], equals: cycle.id } }, select: { id: true },
    });
    if (!existingReview) {
      const maxPosition = await prismadb.tasks.aggregate({ where: { section: reviewSection.id }, _max: { position: true } });
      const review = await prismadb.tasks.create({
        data: {
          v: 0, title: `Роман: проверить ночной пакет ${cycle.direction} — ${cycle.businessDate}`,
          content: `Проверить ${acceptedCount} новых Target: ${targets.map((item) => item.id).join(", ")}. Вернуть структурированный вердикт APPROVED, REVISION_REQUIRED или REJECTED и измеримые причины. Клиентам не писать.`,
          position: (maxPosition._max.position ?? BigInt(0)) + BigInt(1000), priority: "High",
          section: reviewSection.id, user: controller.id, createdBy: controller.id, updatedBy: controller.id,
          dueDateAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
          tags: { kind: "controller-prospect-review", agent: "controller", direction: cycle.direction, sourceCycleId: cycle.id, targetIds: targets.map((item) => item.id), prospectingCycleId: cycle.id },
        },
      });
      await logPipelineEvent({ eventType: "PIPELINE_HANDOFF_CREATED", message: `${cycle.direction}: пакет передан Роману`, direction: cycle.direction, stage: "review", cycleId: cycle.id, taskId: review.id, agentKey: "controller", metadata: { targetCount: acceptedCount } });
    }
    reconciled += 1;
  }

  const reviews = await prismadb.tasks.findMany({
    where: { tags: { path: ["kind"], equals: "controller-prospect-review" }, taskStatus: "ACTIVE" }, take: 25,
  });
  for (const review of reviews) {
    const tags = review.tags && typeof review.tags === "object" && !Array.isArray(review.tags) ? review.tags as Record<string, unknown> : {};
    if (tags.aiRunStatus !== "completed" || tags.handoffCreatedAt || !sales) continue;
    const summary = String(tags.aiRunSummary ?? "");
    if (!/\bAPPROVED\b/.test(summary)) continue;
    const board = review.section ? await prismadb.sections.findUnique({ where: { id: review.section }, include: { board_relation: { include: { sections: true } } } }) : null;
    const salesSection = board?.board_relation
      ? findSection(board.board_relation.sections, ["Подготовка предложения", "Готово к тесту"])
      : undefined;
    if (!salesSection) {
      await reportIncident({
        code: "PIPELINE_SALES_SECTION_MISSING",
        title: `${String(tags.direction ?? "unknown")}: отсутствует этап подготовки продаж`,
        severity: "BLOCKER",
        direction: typeof tags.direction === "string" ? tags.direction : undefined,
        stage: "handoff",
        cycleId: typeof tags.prospectingCycleId === "string" ? tags.prospectingCycleId : undefined,
        taskId: review.id,
        owner: "Роман Ястребов",
        details: { expectedSections: ["Подготовка предложения", "Готово к тесту"] },
      });
      continue;
    }
    const targetIds = Array.isArray(tags.targetIds) ? tags.targetIds.filter((id): id is string => typeof id === "string") : [];
    const direction = typeof tags.direction === "string" ? tags.direction : "unknown";
    const prospectingCycleId = typeof tags.prospectingCycleId === "string" ? tags.prospectingCycleId : undefined;
    const maxPosition = await prismadb.tasks.aggregate({ where: { section: salesSection.id }, _max: { position: true } });
    const salesTask = await prismadb.tasks.create({
      data: {
        v: 0, title: `Марк: подготовить касания — ${String(tags.direction ?? "направление")}`,
        content: `Подготовить персональные черновики первых касаний для одобренных Target: ${targetIds.join(", ")}. Прочитать актуальный регламент коммуникаций. Ночью ничего не отправлять; отправка разрешена только в дневном окне и при наличии требуемого согласования.`,
        position: (maxPosition._max.position ?? BigInt(0)) + BigInt(1000), priority: "High",
        section: salesSection.id, user: sales.id, createdBy: sales.id, updatedBy: sales.id,
        dueDateAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        tags: { kind: "sales-prospect-preparation", agent: "sales", direction, sourceReviewTaskId: review.id, targetIds, ...(prospectingCycleId ? { prospectingCycleId } : {}) },
      },
    });
    await prismadb.tasks.update({ where: { id: review.id }, data: { tags: { ...tags, handoffCreatedAt: now.toISOString(), handoffTaskId: salesTask.id } } });
    await logPipelineEvent({ eventType: "PIPELINE_HANDOFF_CREATED", message: `${direction}: одобренный пакет передан Марку`, direction, stage: "sales-preparation", cycleId: prospectingCycleId, taskId: salesTask.id, agentKey: "sales", metadata: { targetCount: targetIds.length, sourceReviewTaskId: review.id } });
  }
  return { reconciled };
}

export async function recoverRateLimitedTasks(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const candidates = await prismadb.tasks.findMany({
    where: { taskStatus: "ACTIVE", tags: { path: ["aiRunStatus"], equals: "blocked" }, updatedAt: { lt: cutoff } },
    select: { id: true, tags: true }, take: 25,
  });
  let recovered = 0;
  for (const task of candidates) {
    const tags = task.tags && typeof task.tags === "object" && !Array.isArray(task.tags) ? task.tags as Record<string, unknown> : {};
    const error = String(tags.aiRunError ?? "");
    if (!/429|timed out|DataInspectionFailed|data_inspection_failed/i.test(error)) continue;
    const cycles = Number(tags.aiRecoveryCycles ?? 0);
    if (cycles >= 3) continue;
    await prismadb.tasks.update({
      where: { id: task.id },
      data: { tags: { ...tags, aiRunStatus: "failed", aiRunFailures: 0, aiRecoveryCycles: cycles + 1, aiRecoveredAt: now.toISOString() } },
    });
    await logPipelineEvent({ eventType: "AI_TASK_RECOVERY_SCHEDULED", level: "WARNING", message: "AI-задача возвращена в очередь после временной ошибки", taskId: task.id, metadata: { previousError: error.slice(0, 500), recoveryCycle: cycles + 1 } });
    recovered += 1;
  }
  return { recovered };
}
