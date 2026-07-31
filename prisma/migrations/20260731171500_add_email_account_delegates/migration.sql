CREATE TABLE "EmailAccountDelegate" (
    "id" UUID NOT NULL,
    "emailAccountId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAccountDelegate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailAccountDelegate_emailAccountId_userId_key"
ON "EmailAccountDelegate"("emailAccountId", "userId");

CREATE INDEX "EmailAccountDelegate_userId_idx"
ON "EmailAccountDelegate"("userId");

ALTER TABLE "EmailAccountDelegate"
ADD CONSTRAINT "EmailAccountDelegate_emailAccountId_fkey"
FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailAccountDelegate"
ADD CONSTRAINT "EmailAccountDelegate_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "Users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
