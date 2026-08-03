import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { paginationSchema, paginationArgs, listResponse } from "../helpers";
import { sendEmailForUser } from "@/lib/email/send-message";
import { hasFirstMessageApproval } from "@/lib/email/agent-approval";
import { emailAccountAccessWhere } from "@/lib/email/account-access";
import type { AuthzUser } from "@/lib/authz";
import { targetReadScopeWhere } from "@/lib/authz/scopes/crm";
import { getOrFetchEmailBody } from "@/lib/email/get-or-fetch-body";

export const crmEmailAccountTools = [
  {
    name: "crm_list_email_accounts",
    description: "List email accounts owned by or delegated to the authenticated user",
    schema: z.object({ ...paginationSchema }),
    async handler(args: { limit: number; offset: number }, userId: string) {
      const where = { isActive: true, ...emailAccountAccessWhere(userId) };
      const [data, total] = await Promise.all([
        prismadb.emailAccount.findMany({
          where,
          ...paginationArgs(args),
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            label: true,
            imapHost: true,
            imapPort: true,
            imapSsl: true,
            smtpHost: true,
            smtpPort: true,
            smtpSsl: true,
            username: true,
            isActive: true,
            sentFolderName: true,
            lastSyncedAt: true,
            createdAt: true,
            updatedAt: true,
            // passwordEncrypted intentionally excluded for security
          },
        }),
        prismadb.emailAccount.count({ where }),
      ]);
      return listResponse(data, total, args.offset);
    },
  },
  {
    name: "crm_list_emails",
    description: "List synced emails for one connected account",
    schema: z.object({
      accountId: z.string().uuid(),
      folder: z.enum(["INBOX", "SENT"]).optional(),
      ...paginationSchema,
    }),
    async handler(
      args: { accountId: string; folder?: "INBOX" | "SENT"; limit: number; offset: number },
      userId: string
    ) {
      const account = await prismadb.emailAccount.findFirst({
        where: {
          id: args.accountId,
          isActive: true,
          ...emailAccountAccessWhere(userId),
        },
        select: { id: true },
      });
      if (!account) throw new Error("NOT_FOUND");
      const where = {
        emailAccountId: account.id,
        isDeleted: false,
        ...(args.folder && { folder: args.folder }),
      } as const;
      const [data, total] = await Promise.all([
        prismadb.email.findMany({
          where,
          ...paginationArgs(args),
          orderBy: { sentAt: "desc" },
          take: Math.min(args.limit, 50),
        }),
        prismadb.email.count({ where }),
      ]);
      return listResponse(data, total, args.offset);
    },
  },
  {
    name: "crm_get_email",
    description: "Get one synced email from an owned or delegated email account",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string) {
      const email = await prismadb.email.findFirst({
        where: {
          id: args.id,
          isDeleted: false,
          account: emailAccountAccessWhere(userId),
        },
      });
      if (!email) throw new Error("NOT_FOUND");
      if (!email.bodyText && !email.bodyHtml && email.imapUid) {
        const body = await getOrFetchEmailBody(email.id);
        return { data: { ...email, ...body, bodyFetchStatus: body.status } };
      }
      return { data: email };
    },
  },
  {
    name: "crm_send_individual_email",
    description:
      "Send one individual email. A first outbound message requires an approved CRM task; replies to an existing CRM email continue without another approval.",
    schema: z.object({
      accountId: z.string().uuid(),
      to: z.array(z.string().email()).min(1).max(5),
      cc: z.array(z.string().email()).max(5).optional(),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(50_000),
      replyToEmailId: z.string().uuid().optional(),
      approvalTaskId: z.string().uuid().optional(),
      targetId: z.string().uuid().optional(),
    }),
    async handler(
      args: {
        accountId: string;
        to: string[];
        cc?: string[];
        subject: string;
        body: string;
        replyToEmailId?: string;
        approvalTaskId?: string;
        targetId?: string;
      },
      userId: string,
      user: AuthzUser
    ) {
      let inReplyTo: string | undefined;
      if (args.replyToEmailId) {
        const parent = await prismadb.email.findFirst({
          where: {
            id: args.replyToEmailId,
            isDeleted: false,
            account: emailAccountAccessWhere(userId),
          },
          select: { rfcMessageId: true },
        });
        if (!parent) throw new Error("NOT_FOUND");
        inReplyTo = parent.rfcMessageId;
      } else {
        if (!args.approvalTaskId || !args.targetId) {
          throw new Error("APPROVAL_AND_TARGET_REQUIRED");
        }
        const approval = await prismadb.tasks.findFirst({
          where: { id: args.approvalTaskId, user: userId },
          select: {
            comments: {
              include: {
                assigned_user: { select: { role: true } },
              },
            },
          },
        });
        if (!approval || !hasFirstMessageApproval(approval.comments)) {
          throw new Error("APPROVAL_REQUIRED");
        }

        const target = await prismadb.crm_Targets.findFirst({
          where: { id: args.targetId, ...targetReadScopeWhere(user) },
          select: { id: true, email: true },
        });
        if (!target?.email) throw new Error("TARGET_EMAIL_NOT_FOUND");
        const expected = target.email.trim().toLowerCase();
        const recipients = args.to.map((email) => email.trim().toLowerCase());
        if (recipients.length !== 1 || recipients[0] !== expected) {
          throw new Error("TARGET_EMAIL_MISMATCH");
        }

        const existing = await prismadb.email.findFirst({
          where: {
            approvalTaskId: args.approvalTaskId,
            targetId: args.targetId,
            folder: "SENT",
            isDeleted: false,
          },
        });
        if (existing) return { data: existing, deduplicated: true };
      }
      const email = await sendEmailForUser(userId, {
        accountId: args.accountId,
        to: args.to,
        cc: args.cc,
        subject: args.subject,
        body: args.body,
        inReplyTo,
        references: inReplyTo,
        approvalTaskId: args.replyToEmailId ? undefined : args.approvalTaskId,
        targetId: args.replyToEmailId ? undefined : args.targetId,
      });
      return { data: email };
    },
  },
];
