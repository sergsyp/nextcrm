ALTER TABLE "ai_ApprovalRequest"
ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRemindedAt" TIMESTAMP(3);
