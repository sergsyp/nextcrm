import { createHash } from "node:crypto";
import { prismadb } from "@/lib/prisma";
import type {
  AiAgentDefinition,
  AiAgentKey,
  AiTeamKnowledgeDocument,
} from "./types";

function internalKey(agentKey: string, name: string): string {
  return `ai-team/${agentKey}/${name}.md`;
}

export async function upsertAgentKnowledgeDocument(
  agent: AiAgentDefinition,
  userId: string
): Promise<string> {
  const key = internalKey(agent.key, "role-regulation");
  const content = `# ${agent.name}\n\n${agent.purpose}\n\n${agent.instructions.trim()}\n\n## Разрешённые инструменты\n\n${agent.toolNames
    .map((tool) => `- \`${tool}\``)
    .join("\n")}\n`;
  const hash = createHash("sha256").update(content).digest("hex");

  const existing = await prismadb.documents.findFirst({
    where: { key, deletedAt: null },
    select: { id: true },
  });

  const data = {
    document_name: `Регламент: ${agent.name}`,
    description: agent.purpose,
    document_file_url: `internal://${key}`,
    document_file_mimeType: "text/markdown",
    key,
    size: Buffer.byteLength(content),
    content_text: content,
    content_hash: hash,
    summary: agent.purpose,
    processing_status: "READY" as const,
    status: "ACTIVE",
    visibility: "team",
    tags: {
      kind: "ai-agent-regulation",
      agent: agent.key,
      maintainedBy: "nextcrm-ai-team",
    },
    assigned_user: userId,
  };

  if (existing) {
    const updated = await prismadb.documents.update({
      where: { id: existing.id },
      data: { ...data, updatedAt: new Date() },
    });
    return updated.id;
  }

  const created = await prismadb.documents.create({
    data: {
      v: 0,
      ...data,
      createdBy: userId,
      created_by_user: userId,
    },
  });
  return created.id;
}

export async function upsertTeamKnowledgeDocument(
  document: AiTeamKnowledgeDocument,
  ownerUserId: string
): Promise<string> {
  const key = `ai-team/shared/${document.key}.md`;
  const hash = createHash("sha256").update(document.content).digest("hex");
  const existing = await prismadb.documents.findFirst({
    where: { key, deletedAt: null },
    select: { id: true },
  });
  const data = {
    document_name: document.title,
    description: document.description,
    document_file_url: `internal://${key}`,
    document_file_mimeType: "text/markdown",
    key,
    size: Buffer.byteLength(document.content),
    content_text: document.content,
    content_hash: hash,
    summary: document.description,
    processing_status: "READY" as const,
    status: "ACTIVE",
    visibility: "team",
    tags: {
      kind: "ai-team-knowledge",
      maintainedBy: "nextcrm-ai-team",
      ...document.tags,
    },
    assigned_user: ownerUserId,
  };

  if (existing) {
    const updated = await prismadb.documents.update({
      where: { id: existing.id },
      data: { ...data, updatedAt: new Date() },
    });
    return updated.id;
  }

  const created = await prismadb.documents.create({
    data: {
      v: 0,
      ...data,
      createdBy: ownerUserId,
      created_by_user: ownerUserId,
    },
  });
  return created.id;
}

export async function createAgentWorkDocument(input: {
  agentKey: AiAgentKey;
  agentUserId: string;
  taskId: string;
  title: string;
  content: string;
}): Promise<string> {
  const stamp = new Date().toISOString();
  const hash = createHash("sha256").update(input.content).digest("hex");
  const key = internalKey(input.agentKey, `${input.taskId}-${Date.now()}`);

  const document = await prismadb.documents.create({
    data: {
      v: 0,
      document_name: input.title,
      description: `Результат автономной работы агента ${input.agentKey}`,
      document_file_url: `internal://${key}`,
      document_file_mimeType: "text/markdown",
      key,
      size: Buffer.byteLength(input.content),
      content_text: input.content,
      content_hash: hash,
      summary: input.content.slice(0, 500),
      processing_status: "READY",
      status: "ACTIVE",
      visibility: "team",
      tags: {
        kind: "ai-agent-work-result",
        agent: input.agentKey,
        taskId: input.taskId,
        createdAt: stamp,
      },
      assigned_user: input.agentUserId,
      createdBy: input.agentUserId,
      created_by_user: input.agentUserId,
      tasks: { create: { task_id: input.taskId } },
    },
  });

  return document.id;
}
