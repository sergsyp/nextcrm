import type OpenAI from "openai";
import { z } from "zod";
import { createOpenAIClient, AI_CHAT_MODEL } from "@/lib/ai-config";
import { prismadb } from "@/lib/prisma";
import { mapLegacyRole } from "@/lib/authz/roles";
import { allTools } from "@/lib/mcp/tools";
import { getAiAgentDefinition } from "./definitions";
import { getAgentKnowledgeInstructions } from "./knowledge";
import type { AiAgentKey } from "./types";
import {
  eligibleSectionsForAgent,
  isRunnableAiTask,
  selectAllowedTools,
  selectToolsForTask,
  toSerializable,
  withRateLimitBackoff,
} from "./executor-utils";
import {
  classifyAiError,
  logPipelineEvent,
  pipelineContext,
  recordAiUsage,
  reportIncident,
  resolveIncident,
} from "./observability";

type McpTool = (typeof allTools)[number];

function parseTags(tags: unknown): Record<string, unknown> {
  return tags && typeof tags === "object" && !Array.isArray(tags)
    ? (tags as Record<string, unknown>)
    : {};
}

export async function findNextAgentTask(key: AiAgentKey) {
  const definition = getAiAgentDefinition(key);
  if (!definition) throw new Error(`Unknown AI agent: ${key}`);
  const user = await prismadb.users.findUnique({
    where: { email: definition.email },
    select: { id: true },
  });
  if (!user) throw new Error(`AI agent user is not configured: ${definition.email}`);

  const tasks = await prismadb.tasks.findMany({
    where: {
      user: user.id,
      taskStatus: "ACTIVE",
      section: {
        not: null,
      },
      assigned_section: {
        title: { in: [...eligibleSectionsForAgent(key)] },
        board_relation: {
          deletedAt: null,
          title: { not: "Шаблон коммерческой идеи" },
        },
      },
    },
    include: {
      assigned_section: {
        include: { board_relation: true },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 30,
      },
      documents: {
        include: { document: true },
      },
    },
    orderBy: [{ priority: "desc" }, { dueDateAt: "asc" }, { createdAt: "asc" }],
    take: 10,
  });

  return (
    tasks.find((task) => {
      const tags = parseTags(task.tags);
      return isRunnableAiTask(tags);
    }) ?? null
  );
}

async function markRun(
  taskId: string,
  userId: string,
  status: "running" | "completed" | "failed",
  extra: Record<string, unknown> = {}
) {
  const task = await prismadb.tasks.findUnique({
    where: { id: taskId },
    select: { tags: true },
  });
  const tags = parseTags(task?.tags);
  await prismadb.tasks.update({
    where: { id: taskId },
    data: {
      tags: {
        ...tags,
        aiRunStatus: status,
        aiLastRunAt: new Date().toISOString(),
        ...(status === "running" && { aiRunStartedAt: new Date().toISOString() }),
        ...extra,
      },
      updatedBy: userId,
    },
  });
}

export async function runAgentTask(key: AiAgentKey, taskId?: string) {
  const definition = getAiAgentDefinition(key);
  if (!definition) throw new Error(`Unknown AI agent: ${key}`);
  const agentUser = await prismadb.users.findUnique({
    where: { email: definition.email },
    select: { id: true, role: true, userStatus: true },
  });
  if (!agentUser || agentUser.userStatus !== "ACTIVE") {
    throw new Error(`AI agent is not active: ${definition.email}`);
  }

  const task = taskId
    ? await prismadb.tasks.findUnique({
        where: { id: taskId },
        include: {
          assigned_section: { include: { board_relation: true } },
          comments: { orderBy: { createdAt: "asc" }, take: 30 },
          documents: { include: { document: true } },
        },
      })
    : await findNextAgentTask(key);
  if (!task) return { skipped: true, reason: "no eligible task" };
  if (task.user !== agentUser.id) {
    throw new Error("Task is not assigned to this AI agent");
  }
  if (!eligibleSectionsForAgent(key).includes(task.assigned_section?.title ?? "")) {
    throw new Error("Task is outside the agent's eligible sections");
  }

  const context = pipelineContext(task.tags);
  const runStartedAt = Date.now();
  const model = process.env.AI_TEAM_MODEL ?? AI_CHAT_MODEL;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let toolCalls = 0;
  let providerRequestIds: string[] = [];
  let fallbackUsed = false;

  await markRun(task.id, agentUser.id, "running");
  await logPipelineEvent({
    eventType: "AI_RUN_STARTED",
    message: `${definition.name} начал выполнение задачи`,
    agentKey: key,
    taskId: task.id,
    stage: task.assigned_section?.title,
    ...context,
  });
  const allowedTools = selectAllowedTools(allTools, definition.toolNames);
  const tools = selectToolsForTask(
    allowedTools,
    `${task.title}\n${task.content ?? ""}\n${task.assigned_section?.board_relation?.description ?? ""}`,
    parseTags(task.tags).kind
  );
  const authzUser = { id: agentUser.id, role: mapLegacyRole(agentUser.role) };
  const client = createOpenAIClient(process.env.OPENAI_API_KEY ?? "");
  const agentInstructions = await getAgentKnowledgeInstructions(definition);
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: agentInstructions },
    {
      role: "user",
      content: JSON.stringify(
        toSerializable({
          instruction:
            "Выполни назначенную задачу автономно. Используй инструменты CRM и обязательно зафиксируй результат. Не выходи за границы согласований.",
          task,
        })
      ),
    },
  ];
  const openAiTools: OpenAI.ChatCompletionTool[] = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
    },
  }));

  try {
    let finalText = "";
    let turns = 0;
    let reachedFinalAnswer = false;
    while (turns < definition.maxToolTurns) {
      turns += 1;
      let response;
      try {
        response = await withRateLimitBackoff(() =>
          client.chat.completions.create({
          model,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
          temperature: 0.2,
          max_completion_tokens: Number(
            process.env.AI_TEAM_MAX_COMPLETION_TOKENS ?? 8000,
          ),
        }, {
          timeout: Number(process.env.AI_TEAM_LLM_TIMEOUT_MS ?? 120_000),
          })
        );
      } catch (error) {
        const classified = classifyAiError(error);
        const fallbackModel = process.env.AI_TEAM_FALLBACK_MODEL;
        if (classified.code !== "AI_CONTENT_FILTER" || !fallbackModel) throw error;
        fallbackUsed = true;
        response = await withRateLimitBackoff(() => client.chat.completions.create({
          model: fallbackModel,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
          temperature: 0.2,
          max_completion_tokens: Number(process.env.AI_TEAM_MAX_COMPLETION_TOKENS ?? 8000),
        }, { timeout: Number(process.env.AI_TEAM_LLM_TIMEOUT_MS ?? 120_000) }));
      }
      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;
      totalTokens += response.usage?.total_tokens ?? 0;
      const responseId = response.id;
      if (responseId) providerRequestIds.push(responseId);
      const message = response.choices[0]?.message;
      if (!message) throw new Error("AI provider returned no message");
      messages.push(message);
      if (!message.tool_calls?.length) {
        finalText = message.content ?? "";
        reachedFinalAnswer = true;
        break;
      }
      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        toolCalls += 1;
        const tool = tools.find((candidate) => candidate.name === call.function.name);
        if (!tool) throw new Error(`Tool is not allowed: ${call.function.name}`);
        const rawArgs = JSON.parse(call.function.arguments || "{}");
        let args = tool.schema.parse(rawArgs) as Record<string, unknown>;
        if (tool.name === "crm_create_target") {
          const taskTags = parseTags(task.tags);
          const requiredTags = [
            typeof taskTags.direction === "string" ? `direction:${taskTags.direction}` : null,
            typeof taskTags.prospectingCycleId === "string" ? `cycle:${taskTags.prospectingCycleId}` : null,
          ].filter((value): value is string => Boolean(value));
          const requestedTags = Array.isArray(args.tags)
            ? args.tags.filter((value): value is string => typeof value === "string")
            : [];
          args = { ...args, tags: Array.from(new Set([...requestedTags, ...requiredTags])) };
        }
        await markRun(task.id, agentUser.id, "running", {
          aiLastTool: tool.name,
          aiRunTurns: turns,
        });
        const result = await tool.handler(args as never, agentUser.id, authzUser);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toSerializable(result)),
        });
      }
    }

    if (!reachedFinalAnswer) {
      throw new Error("AGENT_TURN_LIMIT_REACHED_WITHOUT_FINAL_RESULT");
    }

    await markRun(task.id, agentUser.id, "completed", {
      aiRunTurns: turns,
      aiRunSummary: finalText.slice(0, 1000),
      aiRunError: null,
      aiRunFailures: 0,
      aiRunCompletedAt: new Date().toISOString(),
    });
    await recordAiUsage({
      provider: process.env.AI_PROVIDER_NAME ?? "openai-compatible",
      model: fallbackUsed ? process.env.AI_TEAM_FALLBACK_MODEL ?? model : model,
      agentKey: key,
      purpose: String(parseTags(task.tags).kind ?? "crm-task"),
      cycleId: context.cycleId,
      taskId: task.id,
      providerRequestIds,
      inputTokens,
      outputTokens,
      totalTokens,
      toolCalls,
      turns,
      durationMs: Date.now() - runStartedAt,
      status: "completed",
      businessResult: finalText.slice(0, 250),
      fallbackUsed,
    });
    await logPipelineEvent({
      eventType: "AI_RUN_COMPLETED",
      message: `${definition.name} завершил задачу`,
      agentKey: key,
      taskId: task.id,
      stage: task.assigned_section?.title,
      metadata: { turns, toolCalls, totalTokens, fallbackUsed },
      ...context,
    });
    await resolveIncident("AI_RUN_FAILED", task.id, "Последующий AI-запуск завершился успешно");
    return { completed: true, taskId: task.id, turns, summary: finalText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifyAiError(error);
    const current = await prismadb.tasks.findUnique({
      where: { id: task.id },
      select: { tags: true },
    });
    const tags = parseTags(current?.tags);
    const failures = Number(tags.aiRunFailures ?? 0) + 1;
    await markRun(task.id, agentUser.id, "failed", {
      aiRunStatus: failures >= 3 ? "blocked" : "failed",
      aiRunFailures: failures,
      aiRunError: message.slice(0, 1000),
    });
    await recordAiUsage({
      provider: process.env.AI_PROVIDER_NAME ?? "openai-compatible",
      model,
      agentKey: key,
      purpose: String(parseTags(task.tags).kind ?? "crm-task"),
      cycleId: context.cycleId,
      taskId: task.id,
      providerRequestIds,
      inputTokens,
      outputTokens,
      totalTokens,
      toolCalls,
      turns: Number(parseTags(current?.tags).aiRunTurns ?? 0),
      durationMs: Date.now() - runStartedAt,
      status: failures >= 3 ? "blocked" : "failed",
      errorCode: classified.code,
      fallbackUsed,
    });
    await logPipelineEvent({
      eventType: failures >= 3 ? "AI_RUN_BLOCKED" : "AI_RUN_FAILED",
      level: failures >= 3 ? "BLOCKER" : "ERROR",
      message: `${definition.name}: ${message.slice(0, 500)}`,
      agentKey: key,
      taskId: task.id,
      stage: task.assigned_section?.title,
      metadata: { code: classified.code, failures, transient: classified.transient },
      ...context,
    });
    if (failures >= 3) {
      await reportIncident({
        code: classified.code,
        title: `AI-задача заблокирована: ${definition.name}`,
        severity: "BLOCKER",
        taskId: task.id,
        stage: task.assigned_section?.title,
        details: { message: message.slice(0, 1000), failures },
        owner: "Роман Ястребов",
        ...context,
      });
    }
    throw error;
  }
}
