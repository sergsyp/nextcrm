import { z } from "zod";
// Import from the leaf errors module, not the @/lib/authz barrel: the barrel
// re-exports session helpers that pull in better-auth (ESM-only), which breaks
// any jest suite transitively importing this file. errors.ts has no imports.
import { AuthorizationError } from "@/lib/authz/errors";
import { prismadb } from "@/lib/prisma";

// ── Pagination ──────────────────────────────────────────────────

export const paginationSchema = {
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
};

export function paginationArgs(args: { limit: number; offset: number }) {
  return { take: args.limit, skip: args.offset };
}

// ── Search ──────────────────────────────────────────────────────

export function ilike(field: string, value: string) {
  return { [field]: { contains: value, mode: "insensitive" as const } };
}

// ── Soft Delete ─────────────────────────────────────────────────

export function softDeleteData(userId: string) {
  return { deletedAt: new Date(), deletedBy: userId };
}

export function isNotDeleted() {
  return { deletedAt: null };
}

// ── Response Helpers ────────────────────────────────────────────

export function jsonSafe<T>(value: T): T {
  if (typeof value === "bigint") {
    return (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString()) as T;
  }
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    ) as T;
  }
  return value;
}

export function listResponse<T>(data: T[], total: number, offset: number) {
  return { data: jsonSafe(data), total, offset };
}

export function itemResponse<T>(data: T) {
  return { data: jsonSafe(data) };
}

// ── Error Helpers ───────────────────────────────────────────────

export function notFound(_entity: string): never {
  throw new Error("NOT_FOUND");
}

export function forbidden(): never {
  throw new Error("FORBIDDEN");
}

export function conflict(msg: string): never {
  throw new Error(`CONFLICT: ${msg}`);
}

export function validationError(msg: string): never {
  throw new Error(`VALIDATION_ERROR: ${msg}`);
}

export function externalError(msg: string): never {
  throw new Error(`EXTERNAL_ERROR: ${msg}`);
}

// Reassignment targets must be a real, active user. The server actions rely on
// the FK constraint alone; checking here keeps the failure a clean NOT_FOUND
// instead of a Prisma error, and stops work being parked on a disabled account.
export async function assertAssignableUser(assigneeId: string): Promise<void> {
  const row = await prismadb.users.findFirst({
    where: { id: assigneeId, userStatus: "ACTIVE" },
    select: { id: true },
  });
  if (!row) notFound("User");
}

// Run an object-level authorization assert (assertCanWriteBoard, etc.) and
// convert a denial into NOT_FOUND so the caller cannot tell whether the id
// exists (no existence oracle). Non-authorization errors propagate unchanged.
export async function assertScopeOrNotFound(
  assert: () => Promise<void>,
  entity: string,
): Promise<void> {
  try {
    await assert();
  } catch (e) {
    if (e instanceof AuthorizationError) notFound(entity);
    throw e;
  }
}
