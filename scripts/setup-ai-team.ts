import dotenv from "dotenv";
import path from "node:path";
import { prismadb } from "@/lib/prisma";
import { ensureAiTeam } from "@/lib/ai-team/setup";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const ownerEmail =
    process.argv.find((arg) => arg.startsWith("--owner="))?.slice("--owner=".length) ??
    process.env.AI_TEAM_OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error(
      "Set AI_TEAM_OWNER_EMAIL or pass --owner=<admin email>"
    );
  }

  const owner = await prismadb.users.findUnique({
    where: { email: ownerEmail },
    select: { id: true, role: true },
  });
  if (!owner) throw new Error(`NextCRM user not found: ${ownerEmail}`);
  if (owner.role !== "admin") {
    throw new Error("AI team owner must have the admin role");
  }

  const result = await ensureAiTeam(owner.id);
  process.stdout.write(
    `${JSON.stringify(
      {
        configured: true,
        users: result.users,
        knowledgeDocuments: result.knowledgeDocumentIds.length,
        templateBoardId: result.templateBoardId,
      },
      null,
      2
    )}\n`
  );
}

main()
  .catch((error) => {
    process.stderr.write(
      `AI team setup failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismadb.$disconnect();
  });
