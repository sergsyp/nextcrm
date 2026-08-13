CREATE TYPE "ai_Event_Level" AS ENUM ('INFO', 'WARNING', 'ERROR', 'BLOCKER');
CREATE TYPE "ai_Incident_Status" AS ENUM ('OPEN', 'RECOVERING', 'RESOLVED');

CREATE TABLE "ai_PipelineEvent" (
  "id" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "level" "ai_Event_Level" NOT NULL DEFAULT 'INFO',
  "environment" TEXT NOT NULL,
  "direction" TEXT,
  "stage" TEXT,
  "cycleId" TEXT,
  "taskId" UUID,
  "targetId" UUID,
  "agentKey" TEXT,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_PipelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_UsageLog" (
  "id" UUID NOT NULL,
  "environment" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "agentKey" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "cycleId" TEXT,
  "taskId" UUID,
  "requestId" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "toolCalls" INTEGER NOT NULL DEFAULT 0,
  "turns" INTEGER NOT NULL DEFAULT 0,
  "retries" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL,
  "estimatedCostUsd" DOUBLE PRECISION,
  "status" TEXT NOT NULL,
  "errorCode" TEXT,
  "businessResult" TEXT,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "providerRequestIds" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_UsageLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_Incident" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "severity" "ai_Event_Level" NOT NULL,
  "status" "ai_Incident_Status" NOT NULL DEFAULT 'OPEN',
  "environment" TEXT NOT NULL,
  "direction" TEXT,
  "stage" TEXT,
  "cycleId" TEXT,
  "taskId" UUID,
  "owner" TEXT,
  "details" JSONB,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recoveryStartedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_Incident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_ProspectingCycle" (
  "id" UUID NOT NULL,
  "cycleKey" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "boardId" UUID NOT NULL,
  "quota" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "taskId" UUID,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_ProspectingCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_Incident_fingerprint_key" ON "ai_Incident"("fingerprint");
CREATE UNIQUE INDEX "ai_ProspectingCycle_cycleKey_key" ON "ai_ProspectingCycle"("cycleKey");
CREATE INDEX "ai_PipelineEvent_createdAt_idx" ON "ai_PipelineEvent"("createdAt");
CREATE INDEX "ai_PipelineEvent_eventType_createdAt_idx" ON "ai_PipelineEvent"("eventType", "createdAt");
CREATE INDEX "ai_PipelineEvent_level_createdAt_idx" ON "ai_PipelineEvent"("level", "createdAt");
CREATE INDEX "ai_PipelineEvent_cycleId_createdAt_idx" ON "ai_PipelineEvent"("cycleId", "createdAt");
CREATE INDEX "ai_PipelineEvent_agentKey_createdAt_idx" ON "ai_PipelineEvent"("agentKey", "createdAt");
CREATE INDEX "ai_PipelineEvent_direction_createdAt_idx" ON "ai_PipelineEvent"("direction", "createdAt");
CREATE INDEX "ai_UsageLog_createdAt_idx" ON "ai_UsageLog"("createdAt");
CREATE INDEX "ai_UsageLog_agentKey_createdAt_idx" ON "ai_UsageLog"("agentKey", "createdAt");
CREATE INDEX "ai_UsageLog_cycleId_createdAt_idx" ON "ai_UsageLog"("cycleId", "createdAt");
CREATE INDEX "ai_UsageLog_status_createdAt_idx" ON "ai_UsageLog"("status", "createdAt");
CREATE INDEX "ai_Incident_status_severity_lastOccurredAt_idx" ON "ai_Incident"("status", "severity", "lastOccurredAt");
CREATE INDEX "ai_Incident_code_lastOccurredAt_idx" ON "ai_Incident"("code", "lastOccurredAt");
CREATE INDEX "ai_ProspectingCycle_businessDate_direction_idx" ON "ai_ProspectingCycle"("businessDate", "direction");
CREATE INDEX "ai_ProspectingCycle_status_updatedAt_idx" ON "ai_ProspectingCycle"("status", "updatedAt");
