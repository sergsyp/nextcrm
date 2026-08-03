import { prismadb } from "@/lib/prisma";
import { decrypt } from "@/lib/email-crypto";
import { fetchBodyByUid } from "@/inngest/lib/imap-utils";

export type StoredEmailBody = {
  bodyText: string | null;
  bodyHtml: string | null;
  status: "READY";
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
}

/**
 * Single body-loading path used by sync jobs, the UI, and MCP.
 * Missing bodies are fetched from IMAP and persisted before being returned.
 */
export async function getOrFetchEmailBody(emailId: string): Promise<StoredEmailBody> {
  const email = await prismadb.email.findUnique({
    where: { id: emailId },
    select: {
      id: true,
      bodyText: true,
      bodyHtml: true,
      imapUid: true,
      folder: true,
      emailAccountId: true,
    },
  });
  if (!email) throw new Error("EMAIL_NOT_FOUND");

  if (email.bodyText || email.bodyHtml) {
    return { bodyText: email.bodyText, bodyHtml: email.bodyHtml, status: "READY" };
  }
  if (!email.imapUid) throw new Error("BODY_FETCH_UNAVAILABLE: missing IMAP UID");

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
  if (!account) throw new Error("BODY_FETCH_UNAVAILABLE: email account not found");

  try {
    const folderName = email.folder === "SENT" ? account.sentFolderName || "Sent" : "INBOX";
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

    await prismadb.email.update({
      where: { id: emailId },
      data: {
        bodyText: body.bodyText ?? null,
        bodyHtml: body.bodyHtml ?? null,
        bodyFetchStatus: "READY",
        bodyFetchAttempts: { increment: 1 },
        bodyFetchLastError: null,
        bodyFetchLastAttemptAt: new Date(),
        bodyFetchedAt: new Date(),
      },
    });
    return { bodyText: body.bodyText ?? null, bodyHtml: body.bodyHtml ?? null, status: "READY" };
  } catch (error) {
    await prismadb.email.update({
      where: { id: emailId },
      data: {
        bodyFetchStatus: "FAILED",
        bodyFetchAttempts: { increment: 1 },
        bodyFetchLastError: errorMessage(error),
        bodyFetchLastAttemptAt: new Date(),
      },
    });
    throw new Error(`BODY_FETCH_FAILED: ${errorMessage(error)}`);
  }
}
