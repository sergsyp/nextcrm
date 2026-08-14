CREATE TYPE "ai_ApprovalRequest_Status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "ai_ApprovalRequest" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "details" JSONB,
  "status" "ai_ApprovalRequest_Status" NOT NULL DEFAULT 'PENDING',
  "requestedByAgent" TEXT NOT NULL,
  "taskId" UUID,
  "dedupeKey" TEXT,
  "telegramChatId" BIGINT,
  "telegramMessageId" BIGINT,
  "decidedByUserId" UUID,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_ApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_ApprovalRequest_dedupeKey_key" ON "ai_ApprovalRequest"("dedupeKey");
CREATE INDEX "ai_ApprovalRequest_status_createdAt_idx" ON "ai_ApprovalRequest"("status", "createdAt");
CREATE INDEX "ai_ApprovalRequest_taskId_status_idx" ON "ai_ApprovalRequest"("taskId", "status");
CREATE INDEX "ai_ApprovalRequest_requestedByAgent_createdAt_idx" ON "ai_ApprovalRequest"("requestedByAgent", "createdAt");

CREATE TABLE "crm_TelegramConversation" (
  "id" UUID NOT NULL,
  "botAccount" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "chatKind" TEXT NOT NULL DEFAULT 'CUSTOMER',
  "username" TEXT,
  "displayName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "leadId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_TelegramConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_TelegramConversation_botAccount_chatId_key" ON "crm_TelegramConversation"("botAccount", "chatId");
CREATE INDEX "crm_TelegramConversation_status_updatedAt_idx" ON "crm_TelegramConversation"("status", "updatedAt");
CREATE INDEX "crm_TelegramConversation_leadId_idx" ON "crm_TelegramConversation"("leadId");

CREATE TABLE "crm_TelegramMessage" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "telegramMessageId" BIGINT NOT NULL,
  "direction" TEXT NOT NULL,
  "senderId" BIGINT,
  "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "metadata" JSONB,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_TelegramMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_TelegramMessage_conversationId_telegramMessageId_direction_key" ON "crm_TelegramMessage"("conversationId", "telegramMessageId", "direction");
CREATE INDEX "crm_TelegramMessage_conversationId_sentAt_idx" ON "crm_TelegramMessage"("conversationId", "sentAt");
CREATE INDEX "crm_TelegramMessage_direction_createdAt_idx" ON "crm_TelegramMessage"("direction", "createdAt");
ALTER TABLE "crm_TelegramMessage" ADD CONSTRAINT "crm_TelegramMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "crm_TelegramConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
