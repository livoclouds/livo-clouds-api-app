-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_condominiumId_idx" ON "push_subscriptions"("userId", "condominiumId");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (notifications iter2): copy each existing single-device subscription stored in
-- whatsapp_notification_preferences.pushSubscriptionJson into the new multi-device table.
-- The legacy column is intentionally kept (soft-deprecate) and no longer written; a later
-- migration drops it. Idempotent: ON CONFLICT keeps re-runs safe.
INSERT INTO "push_subscriptions" ("id", "userId", "condominiumId", "endpoint", "p256dh", "auth", "createdAt", "lastSeenAt")
SELECT
    gen_random_uuid(),
    "userId",
    "condominiumId",
    "pushSubscriptionJson"->>'endpoint',
    "pushSubscriptionJson"->'keys'->>'p256dh',
    "pushSubscriptionJson"->'keys'->>'auth',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "whatsapp_notification_preferences"
WHERE "pushSubscriptionJson" IS NOT NULL
  AND "pushSubscriptionJson"->>'endpoint' IS NOT NULL
  AND "pushSubscriptionJson"->'keys'->>'p256dh' IS NOT NULL
  AND "pushSubscriptionJson"->'keys'->>'auth' IS NOT NULL
ON CONFLICT ("endpoint") DO NOTHING;
