import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { EmailFolder } from "@prisma/client";
import { prismadb } from "@/lib/prisma";
import { decrypt } from "@/lib/email-crypto";
import { assertPublicHost, HostNotAllowedError } from "@/lib/net/host-guard";
import { emailAccountAccessWhere } from "@/lib/email/account-access";

export type SendEmailInput = {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
};

export async function sendEmailForUser(userId: string, input: SendEmailInput) {
  const account = await prismadb.emailAccount.findFirst({
    where: {
      id: input.accountId,
      isActive: true,
      ...emailAccountAccessWhere(userId),
    },
  });
  if (!account) throw new Error("Account not found");

  let pinned: { address: string; hostname: string };
  try {
    pinned = await assertPublicHost(account.smtpHost);
  } catch (error) {
    if (error instanceof HostNotAllowedError) throw new Error("Mail host is not allowed");
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: pinned.address,
    port: account.smtpPort,
    secure: account.smtpSsl,
    auth: { user: account.username, pass: decrypt(account.passwordEncrypted) },
    ...({ servername: account.smtpHost } as { servername: string }),
  });
  const info = await transporter.sendMail({
    from: account.username,
    to: input.to.join(", "),
    cc: input.cc?.join(", "),
    bcc: input.bcc?.join(", "),
    subject: input.subject,
    text: input.body,
    inReplyTo: input.inReplyTo,
    references: input.references,
  });
  return prismadb.email.create({
    data: {
      emailAccountId: input.accountId,
      userId: account.userId,
      rfcMessageId: info.messageId ?? `local-${crypto.randomUUID()}@nextcrm`,
      folder: EmailFolder.SENT,
      subject: input.subject,
      fromEmail: account.username,
      toRecipients: input.to.map((email) => ({ email })),
      ccRecipients: input.cc?.map((email) => ({ email })) ?? [],
      bccRecipients: input.bcc?.map((email) => ({ email })) ?? [],
      bodyText: input.body,
      sentAt: new Date(),
      isRead: true,
    },
  });
}
