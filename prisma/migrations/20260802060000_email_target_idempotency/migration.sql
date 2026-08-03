ALTER TABLE "Email"
  ADD COLUMN "approvalTaskId" UUID,
  ADD COLUMN "targetId" UUID;

CREATE UNIQUE INDEX "Email_approvalTaskId_targetId_key"
  ON "Email"("approvalTaskId", "targetId");
