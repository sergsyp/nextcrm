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
