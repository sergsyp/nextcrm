import OpenAI from "openai";

export const AI_BASE_URL =
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const AI_CHAT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export const AI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

export function createOpenAIClient(apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: AI_BASE_URL,
  });
}
