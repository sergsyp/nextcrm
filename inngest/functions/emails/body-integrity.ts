import { inngest } from "@/inngest/client";
import { prismadb } from "@/lib/prisma";
import { reportIncident, resolveIncident } from "@/lib/ai-team/observability";

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

    const failures = await step.run("find-terminal-failures", () =>
      prismadb.email.findMany({
        where: {
          isDeleted: false,
          imapUid: { not: null },
          bodyText: null,
          bodyHtml: null,
          bodyFetchAttempts: { gte: 3 },
        },
        select: { id: true, bodyFetchLastError: true, bodyFetchLastAttemptAt: true },
        take: 100,
      })
    );
    if (failures.length > 0) {
      await reportIncident({
        code: "EMAIL_BODY_FETCH_EXHAUSTED",
        title: `${failures.length} писем не удалось загрузить после трёх попыток`,
        severity: "ERROR",
        stage: "email-sync",
        owner: "CRM system",
        details: { emails: failures },
      });
    } else {
      await resolveIncident("EMAIL_BODY_FETCH_EXHAUSTED", undefined, "Все тела писем загружены или исключены из синхронизации");
    }
    return { retried: retryable.length, terminalFailures: failures.length };
  }
);
