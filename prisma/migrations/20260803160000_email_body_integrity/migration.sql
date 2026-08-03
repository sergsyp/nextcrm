ALTER TABLE "Email"
  ADD COLUMN "bodyFetchStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "bodyFetchAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bodyFetchLastError" TEXT,
  ADD COLUMN "bodyFetchLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "bodyFetchedAt" TIMESTAMP(3);

UPDATE "Email"
SET "bodyFetchStatus" = 'READY', "bodyFetchedAt" = COALESCE("updatedAt", NOW())
WHERE "bodyText" IS NOT NULL OR "bodyHtml" IS NOT NULL;

CREATE INDEX "Email_bodyFetchStatus_createdAt_idx"
  ON "Email"("bodyFetchStatus", "createdAt");
