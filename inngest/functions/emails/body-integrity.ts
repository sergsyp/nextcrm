import { inngest } from "@/inngest/client";
import { prismadb } from "@/lib/prisma";

/** Retries synced messages whose bodies have not reached READY within ten minutes. */
export const emailBodyIntegrity = inngest.createFunction(
  {
    id: "email-body-integrity",
    name: "Email: Body integrity",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - 10 * 60 * 1_000);
    const retryable = await step.run("find-missing-bodies", () =>
      prismadb.email.findMany({
        where: {
          isDeleted: false,
          imapUid: { not: null },
          bodyText: null,
          bodyHtml: null,
          bodyFetchAttempts: { lt: 3 },
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 100,
      })
    );

    if (retryable.length > 0) {
      await step.sendEvent(
        "retry-body-fetch",
        retryable.map(({ id }) => ({ name: "email/link-crm" as const, data: { emailId: id } }))
      );
    }

    const failed = await step.run("count-terminal-failures", () =>
      prismadb.email.count({
        where: {
          isDeleted: false,
          imapUid: { not: null },
          bodyText: null,
          bodyHtml: null,
          bodyFetchAttempts: { gte: 3 },
        },
      })
    );
    if (failed > 0) {
      console.error(`[email-body-integrity] ${failed} email(s) failed body loading after 3 attempts`);
    }
    return { retried: retryable.length, terminalFailures: failed };
  }
);
