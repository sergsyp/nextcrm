import type { AiAgentKey } from "./types";

const SECTION_BY_AGENT: Record<AiAgentKey, readonly string[]> = {
  researcher: ["Входящие идеи", "Исследование"],
  sales: ["Подготовка предложения", "Готово к тесту", "Тест продаж"],
  controller: ["Проверка"],
};

export function eligibleSectionsForAgent(key: AiAgentKey): readonly string[] {
  return SECTION_BY_AGENT[key];
}

export function selectAllowedTools<T extends { name: string }>(
  tools: readonly T[],
  names: readonly string[]
): T[] {
  const allowed = new Set(names);
  const selected = tools.filter((tool) => allowed.has(tool.name));
  const found = new Set(selected.map((tool) => tool.name));
  const missing = names.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`Unknown AI agent tools: ${missing.join(", ")}`);
  }
  return selected;
}

export function toSerializable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toSerializable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toSerializable(item)])
    );
  }
  return value;
}

export function isRunnableAiTask(tags: Record<string, unknown>, now = new Date()): boolean {
  if (tags.aiRunStatus === "blocked" || tags.aiRunStatus === "completed") return false;
  if (tags.aiRunStatus !== "running") return true;
  const startedAt = typeof tags.aiRunStartedAt === "string"
    ? Date.parse(tags.aiRunStartedAt)
    : Number.NaN;
  return !Number.isFinite(startedAt) || now.getTime() - startedAt > 60 * 60 * 1000;
}

const CORE_TOOL_NAMES = new Set([
  "projects_list_boards",
  "projects_get_board",
  "projects_list_tasks",
  "projects_get_task",
  "projects_list_comments",
  "projects_create_task",
  "projects_update_task",
  "projects_move_task",
  "projects_add_comment",
  "projects_assign_document",
  "crm_list_documents",
  "crm_get_document",
  "crm_create_text_document",
  "crm_link_document",
  "crm_list_activities",
  "crm_create_activity",
]);

const TOOL_KEYWORDS: Array<{ pattern: RegExp; prefixes: string[] }> = [
  { pattern: /клиент|компан|контакт|account|contact/i, prefixes: ["crm_list_accounts", "crm_get_account", "crm_search_accounts", "crm_create_account", "crm_update_account", "crm_list_contacts", "crm_get_contact", "crm_search_contacts", "crm_create_contact", "crm_update_contact"] },
  { pattern: /лид|сделк|продаж|lead|opportunit/i, prefixes: ["crm_list_leads", "crm_get_lead", "crm_search_leads", "crm_create_lead", "crm_update_lead", "crm_list_opportunities", "crm_get_opportunity", "crm_search_opportunities", "crm_create_opportunity", "crm_update_opportunity"] },
  { pattern: /целе|target|обогащ|enrich/i, prefixes: ["crm_list_targets", "crm_get_target", "crm_search_targets", "crm_create_target", "crm_update_target", "crm_list_target_lists", "crm_get_target_list", "crm_create_target_list", "crm_update_target_list", "crm_add_to_target_list", "crm_enrich"] },
  { pattern: /поиск|источник|сайт|кандидат|компан|web|search/i, prefixes: ["crm_web_search"] },
  { pattern: /почт|письм|email|переписк/i, prefixes: ["crm_list_email_accounts", "crm_list_emails", "crm_get_email", "crm_send_individual_email"] },
  { pattern: /кампан|рассыл|campaign/i, prefixes: ["campaigns_"] },
  { pattern: /продукт|товар|услуг|тариф|product/i, prefixes: ["crm_list_products", "crm_get_product", "crm_create_product", "crm_update_product"] },
  { pattern: /отч[её]т|метрик|report|аналит/i, prefixes: ["reports_"] },
  { pattern: /лендинг|landing|публикац/i, prefixes: ["crm_publish_landing"] },
];

export function selectToolsForTask<T extends { name: string }>(
  allowedTools: readonly T[],
  taskText: string,
  taskKind?: unknown
): T[] {
  if (taskKind === "single-target-recovery") {
    const recoveryTools = new Set([
      "projects_get_task",
      "projects_add_comment",
      "crm_get_target",
      "crm_list_email_accounts",
      "crm_send_individual_email",
    ]);
    return allowedTools.filter((tool) => recoveryTools.has(tool.name));
  }
  const selected = new Set(CORE_TOOL_NAMES);
  for (const category of TOOL_KEYWORDS) {
    if (!category.pattern.test(taskText)) continue;
    for (const tool of allowedTools) {
      if (category.prefixes.some((prefix) => tool.name.startsWith(prefix))) {
        selected.add(tool.name);
      }
    }
  }
  return allowedTools.filter((tool) => selected.has(tool.name));
}

const RATE_LIMIT_BACKOFF_MS = [5_000, 10_000, 20_000] as const;

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  return (
    candidate.status === 429 ||
    candidate.statusCode === 429 ||
    candidate.response?.status === 429 ||
    candidate.code === "rate_limit_exceeded"
  );
}

export async function withRateLimitBackoff<T>(
  operation: () => Promise<T>,
  sleep: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = RATE_LIMIT_BACKOFF_MS[attempt];
      if (!isRateLimitError(error) || delayMs === undefined) throw error;
      await sleep(delayMs);
    }
  }
}
