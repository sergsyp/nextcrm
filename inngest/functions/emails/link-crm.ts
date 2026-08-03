import { inngest } from "@/inngest/client";
import { prismadb } from "@/lib/prisma";
import { getOrFetchEmailBody } from "@/lib/email/get-or-fetch-body";

export const emailLinkCrm = inngest.createFunction(
  {
    id: "email-link-crm",
    name: "Email: Link to CRM",
    triggers: [{ event: "email/link-crm" }],
  },
  async ({ event, step }) => {
    const { emailId } = event.data as { emailId: string };

    const email = await prismadb.email.findUnique({
      where: { id: emailId },
      select: {
        fromEmail: true,
        toRecipients: true,
        ccRecipients: true,
        imapUid: true,
        folder: true,
        emailAccountId: true,
      },
    });
    if (!email) return { skipped: "not found" };

    // Collect all addresses (exclude BCC — privacy)
    const addresses = [
      email.fromEmail,
      ...(email.toRecipients as { email?: string }[]).map((r) => r.email),
      ...(email.ccRecipients as { email?: string }[]).map((r) => r.email),
    ]
      .filter((e): e is string => typeof e === "string" && e.length > 0)
      .map((e) => e.toLowerCase());

    const linked = await step.run("match-and-link", async () => {
      if (addresses.length === 0) return 0;
      const [contacts, accounts, targets] = await Promise.all([
        prismadb.crm_Contacts.findMany({
          where: { email: { in: addresses } },
          select: { id: true },
        }),
        prismadb.crm_Accounts.findMany({
          where: { email: { in: addresses } },
          select: { id: true },
        }),
        prismadb.crm_Targets.findMany({
          where: {
            deletedAt: null,
            OR: [
              { email: { in: addresses, mode: "insensitive" } },
              { personal_email: { in: addresses, mode: "insensitive" } },
              { company_email: { in: addresses, mode: "insensitive" } },
            ],
          },
          select: { id: true },
          take: 2,
        }),
      ]);

      const contactLinks = contacts.map((c) => ({ emailId, contactId: c.id }));
      const accountLinks = accounts.map((a) => ({ emailId, accountId: a.id }));

      if (contactLinks.length > 0) {
        await prismadb.emailsToContacts.createMany({ data: contactLinks, skipDuplicates: true });
      }
      if (accountLinks.length > 0) {
        await prismadb.emailsToAccounts.createMany({ data: accountLinks, skipDuplicates: true });
      }

      // Email.targetId is deliberately set only for one unambiguous exact match.
      if (targets.length === 1) {
        await prismadb.email.update({ where: { id: emailId }, data: { targetId: targets[0].id } });
      } else if (targets.length > 1) {
        console.warn(`[link-crm] Multiple Target matches for email ${emailId}; targetId left unset`);
      }

      return contactLinks.length + accountLinks.length + (targets.length === 1 ? 1 : 0);
    });

    // Body preservation is independent of CRM matching. Every synced IMAP message gets a body.
    if (email.imapUid) {
      await step.run("fetch-and-save-body", async () => getOrFetchEmailBody(emailId));
      if (linked > 0) {
        await step.sendEvent("trigger-embed", {
          name: "email/embed-email",
          data: { emailId },
        });
      }
    }

    return { linked };
  }
);
