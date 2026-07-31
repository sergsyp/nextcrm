import OpenAI from "openai";
import { readFileSync } from "node:fs";

export const AI_BASE_URL =
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const AI_CHAT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export const AI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

export function resolveOpenAIApiKey(explicitKey?: string): string {
  if (explicitKey?.trim()) return explicitKey.trim();
  if (process.env.OPENAI_API_KEY?.trim()) {
    return process.env.OPENAI_API_KEY.trim();
  }
  if (process.env.OPENAI_API_KEY_FILE?.trim()) {
    const key = readFileSync(process.env.OPENAI_API_KEY_FILE.trim(), "utf8").trim();
    if (key) return key;
  }
  return "";
}

export function createOpenAIClient(apiKey?: string) {
  return new OpenAI({
    apiKey: resolveOpenAIApiKey(apiKey),
    baseURL: AI_BASE_URL,
  });
}
