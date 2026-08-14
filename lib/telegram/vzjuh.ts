import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const VZJUH_BOT_ACCOUNT = "vzjuh_bot";

function required(name: string): string {
  const configured = name === "VZJUH_TELEGRAM_BOT_TOKEN"
    ? {
        value: process.env.VZJUH_TELEGRAM_BOT_TOKEN,
        file: process.env.VZJUH_TELEGRAM_BOT_TOKEN_FILE,
      }
    : name === "VZJUH_TELEGRAM_WEBHOOK_SECRET"
      ? {
          value: process.env.VZJUH_TELEGRAM_WEBHOOK_SECRET,
          file: process.env.VZJUH_TELEGRAM_WEBHOOK_SECRET_FILE,
        }
      : name === "VZJUH_TELEGRAM_RELAY_SECRET"
        ? {
            value: process.env.VZJUH_TELEGRAM_RELAY_SECRET,
            file: process.env.VZJUH_TELEGRAM_RELAY_SECRET_FILE,
          }
      : name === "VZJUH_TELEGRAM_ADMIN_CHAT_ID"
        ? { value: process.env.VZJUH_TELEGRAM_ADMIN_CHAT_ID, file: undefined }
        : { value: undefined, file: undefined };
  const value = configured.value?.trim();
  if (value) return value;
  const file = configured.file?.trim();
  if (file) {
    const fromFile = readFileSync(file, "utf8").trim();
    if (fromFile) return fromFile;
  }
  throw new Error(`${name} is not configured`);
}

export function vzjuhAdminChatId(): bigint {
  return BigInt(required("VZJUH_TELEGRAM_ADMIN_CHAT_ID"));
}

export function verifyVzjuhWebhookSecret(value: string | null): boolean {
  let expected: string | undefined;
  try {
    expected = required("VZJUH_TELEGRAM_WEBHOOK_SECRET");
  } catch {
    return false;
  }
  if (!expected || !value) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(value);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type TelegramMethod = "sendMessage" | "editMessageText" | "answerCallbackQuery";

export async function callVzjuhTelegram<T>(method: TelegramMethod, body: Record<string, unknown>): Promise<T> {
  const relayUrl = process.env.VZJUH_TELEGRAM_RELAY_URL?.trim().replace(/\/$/, "");
  if (relayUrl) {
    const payload = JSON.stringify({ method, body });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", required("VZJUH_TELEGRAM_RELAY_SECRET"))
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    const response = await fetch(`${relayUrl}/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vzjuh-timestamp": timestamp,
        "x-vzjuh-signature": signature,
      },
      body: payload,
    });
    const relayed = await response.json() as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || !relayed.ok) throw new Error(`TELEGRAM_RELAY_FAILED: ${relayed.description ?? response.status}`);
    return relayed.result as T;
  }
  const token = required("VZJUH_TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok) throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED: ${payload.description ?? response.status}`);
  return payload.result as T;
}

export function approvalCallbackData(id: string, decision: "approve" | "reject"): string {
  return `approval:${id}:${decision}`;
}

export function parseApprovalCallback(value: string): { id: string; decision: "APPROVED" | "REJECTED" } | null {
  const match = /^approval:([0-9a-f-]{36}):(approve|reject)$/i.exec(value);
  if (!match) return null;
  return { id: match[1], decision: match[2] === "approve" ? "APPROVED" : "REJECTED" };
}
