import { prismadb } from "@/lib/prisma";
import { getOrFetchEmailBody } from "@/lib/email/get-or-fetch-body";

async function main() {
  let restored = 0;
  let failed = 0;
  const emails = await prismadb.email.findMany({
    where: { isDeleted: false, imapUid: { not: null }, bodyText: null, bodyHtml: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (const { id } of emails) {
    try {
      await getOrFetchEmailBody(id);
      restored += 1;
    } catch (error) {
      failed += 1;
      console.error(`[backfill-email-bodies] ${id}:`, error);
    }
  }
  console.log(JSON.stringify({ scanned: emails.length, restored, failed }));
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prismadb.$disconnect());
