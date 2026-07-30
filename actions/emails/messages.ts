"use server";
import { getSession } from "@/lib/auth-server";

import { prismadb } from "@/lib/prisma";
import { decrypt } from "@/lib/email-crypto";
import { EmailFolder } from "@prisma/client";
import { sendEmailForUser, type SendEmailInput } from "@/lib/email/send-message";

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

  // Lazy body fetch for emails not yet CRM-linked at sync time
  if (!email.bodyText && !email.bodyHtml && email.imapUid) {
    try {
      const account = await prismadb.emailAccount.findUnique({
        where: { id: email.emailAccountId },
        select: {
          username: true,
          passwordEncrypted: true,
          imapHost: true,
          imapPort: true,
          imapSsl: true,
          sentFolderName: true,
        },
      });

      if (account) {
        const { fetchBodyByUid } = await import("@/inngest/lib/imap-utils");
        const folderName = email.folder === "SENT" ? (account.sentFolderName || "Sent") : "INBOX";
        const body = await fetchBodyByUid(
          {
            username: account.username,
            password: decrypt(account.passwordEncrypted),
            imapHost: account.imapHost,
            imapPort: account.imapPort,
            imapSsl: account.imapSsl,
          },
          folderName,
          email.imapUid
        );

        if (body.bodyText || body.bodyHtml) {
          await prismadb.email.update({
            where: { id },
            data: { bodyText: body.bodyText ?? null, bodyHtml: body.bodyHtml ?? null },
          });
          // Patch in-memory so caller gets the body immediately (before any send that may throw)
          email.bodyText = body.bodyText ?? null;
          email.bodyHtml = body.bodyHtml ?? null;
          // Trigger embed only if already CRM-linked (avoids embedding unrelated emails)
          const isLinked = email.contacts.length > 0 || email.accounts.length > 0;
          if (isLinked) {
            const { inngest } = await import("@/inngest/client");
            inngest.send({ name: "email/embed-email", data: { emailId: id } });
          }
        }
      }
    } catch {
      // Body fetch failed — return email without body; display will show a fallback
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
