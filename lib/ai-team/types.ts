export const AI_AGENT_KEYS = ["researcher", "sales", "controller"] as const;

export type AiAgentKey = (typeof AI_AGENT_KEYS)[number];

export interface AiAgentDefinition {
  key: AiAgentKey;
  name: string;
  email: string;
  crmRole: "user" | "manager";
  purpose: string;
  instructions: string;
  toolNames: readonly string[];
  maxToolTurns: number;
}

export interface AiTeamSetupResult {
  users: Record<AiAgentKey, string>;
  knowledgeDocumentIds: string[];
  templateBoardId: string;
}

export interface AiTeamKnowledgeDocument {
  key: string;
  title: string;
  description: string;
  content: string;
  tags: Record<string, string>;
}
