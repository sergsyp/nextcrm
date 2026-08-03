"use server";
import { getSession } from "@/lib/auth-server";

import { prismadb } from "@/lib/prisma";
import { EmailFolder } from "@prisma/client";
import { sendEmailForUser, type SendEmailInput } from "@/lib/email/send-message";
import { getOrFetchEmailBody } from "@/lib/email/get-or-fetch-body";

const PAGE_SIZE = 50;
const MAX_COUNT = 10_000;

async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id as string;
}

export async function getEmails(
  accountId: string,
  folder: EmailFolder,
  page: number,
  search?: string
) {
  const userId = await requireSession();

  const baseWhere = {
    userId,
    emailAccountId: accountId,
    folder,
    isDeleted: false,
  } as const;

  // Build where clause with optional text search fallback
  const where =
    search && search.length >= 3
      ? {
          ...baseWhere,
          OR: [
            { subject: { contains: search, mode: "insensitive" as const } },
            { fromEmail: { contains: search, mode: "insensitive" as const } },
            { fromName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : baseWhere;

  const [emails, rawCount] = await Promise.all([
    prismadb.email.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        subject: true,
        fromName: true,
        fromEmail: true,
        sentAt: true,
        isRead: true,
        folder: true,
      },
    }),
    prismadb.email.count({ where }),
  ]);

  const total = Math.min(rawCount, MAX_COUNT);
  return { emails, total, page, totalPages: Math.ceil(total / PAGE_SIZE) };
}

export async function getEmail(id: string) {
  const userId = await requireSession();
  const email = await prismadb.email.findFirst({
    where: { id, userId, isDeleted: false },
    include: {
      contacts: { include: { contact: { select: { id: true, first_name: true, last_name: true } } } },
      accounts: { include: { account: { select: { id: true, name: true } } } },
    },
  });
  if (!email) throw new Error("Not found");

  // Use the same persistent body-loading path as sync and MCP.
  if (!email.bodyText && !email.bodyHtml && email.imapUid) {
    try {
      const body = await getOrFetchEmailBody(id);
      email.bodyText = body.bodyText;
      email.bodyHtml = body.bodyHtml;
      const isLinked = email.contacts.length > 0 || email.accounts.length > 0 || !!email.targetId;
      if (isLinked) {
        const { inngest } = await import("@/inngest/client");
        inngest.send({ name: "email/embed-email", data: { emailId: id } });
      }
    } catch {
      // The shared service persisted FAILED diagnostics; the UI can render its fallback.
    }
  }

  // Mark as read (fire-and-forget)
  if (!email.isRead) {
    prismadb.email.update({ where: { id }, data: { isRead: true } }).catch(() => {});
  }

  return email;
}

export async function deleteEmail(id: string) {
  const userId = await requireSession();
  const email = await prismadb.email.findFirst({ where: { id, userId, isDeleted: false } });
  if (!email) throw new Error("Not found");
  await prismadb.email.update({ where: { id }, data: { isDeleted: true } });
}

export async function sendEmail(input: SendEmailInput) {
  const userId = await requireSession();
  await sendEmailForUser(userId, input);
}
