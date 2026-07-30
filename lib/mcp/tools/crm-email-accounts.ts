import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { paginationSchema, paginationArgs, listResponse } from "../helpers";
import { sendEmailForUser } from "@/lib/email/send-message";
import { hasFirstMessageApproval } from "@/lib/email/agent-approval";

export const crmEmailAccountTools = [
  {
    name: "crm_list_email_accounts",
    description: "List the authenticated user's connected email accounts",
    schema: z.object({ ...paginationSchema }),
    async handler(args: { limit: number; offset: number }, userId: string) {
      const where = { userId, isActive: true };
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
        where: { id: args.accountId, userId, isActive: true },
        select: { id: true },
      });
      if (!account) throw new Error("NOT_FOUND");
      const where = {
        emailAccountId: account.id,
        userId,
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
    description: "Get one synced email owned by the authenticated user",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string) {
      const email = await prismadb.email.findFirst({
        where: { id: args.id, userId, isDeleted: false },
      });
      if (!email) throw new Error("NOT_FOUND");
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
      },
      userId: string
    ) {
      let inReplyTo: string | undefined;
      if (args.replyToEmailId) {
        const parent = await prismadb.email.findFirst({
          where: { id: args.replyToEmailId, userId, isDeleted: false },
          select: { rfcMessageId: true },
        });
        if (!parent) throw new Error("NOT_FOUND");
        inReplyTo = parent.rfcMessageId;
      } else {
        if (!args.approvalTaskId) throw new Error("APPROVAL_REQUIRED");
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
      }
      const email = await sendEmailForUser(userId, {
        accountId: args.accountId,
        to: args.to,
        cc: args.cc,
        subject: args.subject,
        body: args.body,
        inReplyTo,
        references: inReplyTo,
      });
      return { data: email };
    },
  },
];
