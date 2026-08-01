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
} from "./executor-utils";

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

  await markRun(task.id, agentUser.id, "running");
  const allowedTools = selectAllowedTools(allTools, definition.toolNames);
  const tools = selectToolsForTask(
    allowedTools,
    `${task.title}\n${task.content ?? ""}\n${task.assigned_section?.board_relation?.description ?? ""}`
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
    while (turns < definition.maxToolTurns) {
      turns += 1;
      const response = await client.chat.completions.create({
        model: process.env.AI_TEAM_MODEL ?? AI_CHAT_MODEL,
        messages,
        tools: openAiTools,
        tool_choice: "auto",
        temperature: 0.2,
        max_completion_tokens: 2000,
      }, {
        timeout: Number(process.env.AI_TEAM_LLM_TIMEOUT_MS ?? 120_000),
      });
      const message = response.choices[0]?.message;
      if (!message) throw new Error("AI provider returned no message");
      messages.push(message);
      if (!message.tool_calls?.length) {
        finalText = message.content ?? "";
        break;
      }
      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        const tool = tools.find((candidate) => candidate.name === call.function.name);
        if (!tool) throw new Error(`Tool is not allowed: ${call.function.name}`);
        const rawArgs = JSON.parse(call.function.arguments || "{}");
        const args = tool.schema.parse(rawArgs);
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

    await markRun(task.id, agentUser.id, "completed", {
      aiRunTurns: turns,
      aiRunSummary: finalText.slice(0, 1000),
    });
    return { completed: true, taskId: task.id, turns, summary: finalText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    throw error;
  }
}
