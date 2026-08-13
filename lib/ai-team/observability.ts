import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prismadb } from "@/lib/prisma";

export type PipelineLevel = "INFO" | "WARNING" | "ERROR" | "BLOCKER";

const environment = process.env.NEXTCRM_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";

export function pipelineContext(tags: unknown) {
  const value = tags && typeof tags === "object" && !Array.isArray(tags)
    ? tags as Record<string, unknown> : {};
  return {
    cycleId: typeof value.prospectingCycleId === "string" ? value.prospectingCycleId : undefined,
    direction: typeof value.direction === "string" ? value.direction : undefined,
  };
}

export async function logPipelineEvent(input: {
  eventType: string;
  level?: PipelineLevel;
  message: string;
  direction?: string;
  stage?: string;
  cycleId?: string;
  taskId?: string;
  targetId?: string;
  agentKey?: string;
  correlationId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prismadb.ai_PipelineEvent.create({
    data: { environment, level: input.level ?? "INFO", ...input },
  });
}

export function classifyAiError(error: unknown): { code: string; transient: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|rate.?limit/i.test(message)) return { code: "AI_RATE_LIMITED", transient: true };
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return { code: "AI_TIMEOUT", transient: true };
  if (/DataInspectionFailed|data_inspection_failed/i.test(message)) return { code: "AI_CONTENT_FILTER", transient: true };
  if (/AGENT_TURN_LIMIT/i.test(message)) return { code: "AGENT_TURN_LIMIT", transient: false };
  if (/NOT_FOUND/i.test(message)) return { code: "KNOWLEDGE_OR_ENTITY_NOT_FOUND", transient: false };
  if (/JSON|Unexpected token|Unterminated string/i.test(message)) return { code: "AGENT_INVALID_JSON", transient: true };
  if (/5\d\d|provider.*unavailable/i.test(message)) return { code: "AI_PROVIDER_UNAVAILABLE", transient: true };
  return { code: "AI_RUN_FAILED", transient: false };
}

export async function recordAiUsage(input: {
  provider: string;
  model: string;
  agentKey: string;
  purpose: string;
  cycleId?: string;
  taskId?: string;
  requestId?: string;
  providerRequestIds?: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  turns: number;
  retries?: number;
  durationMs: number;
  status: string;
  errorCode?: string;
  businessResult?: string;
  fallbackUsed?: boolean;
}) {
  const inputRate = Number(process.env.AI_INPUT_USD_PER_MILLION_TOKENS ?? "");
  const outputRate = Number(process.env.AI_OUTPUT_USD_PER_MILLION_TOKENS ?? "");
  const estimatedCostUsd = Number.isFinite(inputRate) && Number.isFinite(outputRate)
    ? (input.inputTokens * inputRate + input.outputTokens * outputRate) / 1_000_000
    : undefined;
  return prismadb.ai_UsageLog.create({
    data: {
      environment,
      provider: input.provider,
      model: input.model,
      agentKey: input.agentKey,
      purpose: input.purpose,
      cycleId: input.cycleId,
      taskId: input.taskId,
      requestId: input.requestId,
      providerRequestIds: input.providerRequestIds ?? [],
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
      toolCalls: input.toolCalls,
      turns: input.turns,
      retries: input.retries ?? 0,
      durationMs: input.durationMs,
      estimatedCostUsd,
      status: input.status,
      errorCode: input.errorCode,
      businessResult: input.businessResult,
      fallbackUsed: input.fallbackUsed ?? false,
    },
  });
}

export async function reportIncident(input: {
  code: string;
  title: string;
  severity: PipelineLevel;
  direction?: string;
  stage?: string;
  cycleId?: string;
  taskId?: string;
  owner?: string;
  details?: Prisma.InputJsonValue;
}) {
  const fingerprint = createHash("sha256")
    .update([environment, input.code, input.direction ?? "", input.stage ?? "", input.taskId ?? ""].join(":"))
    .digest("hex");
  const existing = await prismadb.ai_Incident.findUnique({ where: { fingerprint } });
  if (existing) {
    return prismadb.ai_Incident.update({
      where: { id: existing.id },
      data: {
        occurrences: { increment: 1 },
        status: "OPEN",
        lastOccurredAt: new Date(),
        resolvedAt: null,
        resolution: null,
        severity: input.severity,
        details: input.details,
      },
    });
  }
  return prismadb.ai_Incident.create({
    data: { environment, fingerprint, status: "OPEN", ...input },
  });
}

export async function resolveIncident(code: string, taskId: string, resolution: string) {
  const incidents = await prismadb.ai_Incident.findMany({
    where: { code, taskId, status: { in: ["OPEN", "RECOVERING"] } },
    select: { id: true },
  });
  await prismadb.ai_Incident.updateMany({
    where: { id: { in: incidents.map((item) => item.id) } },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolution },
  });
}
