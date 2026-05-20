-- CreateEnum
CREATE TYPE "RootScope" AS ENUM ('ACTIVE_TENANT', 'ALL', 'SPECIFIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'IMPORT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'IMPORT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'IMPORT_WITH_WARNINGS';
ALTER TYPE "NotificationType" ADD VALUE 'IMPORT_DUPLICATE';
ALTER TYPE "NotificationType" ADD VALUE 'CLASSIFICATION_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'RECONCILIATION_RULE_MODIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_EVENT_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_EVENT_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'USER_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'PERMISSIONS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'SESSION_EXPIRING';

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_condominiumId_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "aggregateCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "aggregateUntil" TIMESTAMP(3),
ADD COLUMN     "data" JSONB,
ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "linkUrl" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ALTER COLUMN "condominiumId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "root_notification_scopes" (
    "userId" TEXT NOT NULL,
    "scope" "RootScope" NOT NULL DEFAULT 'ACTIVE_TENANT',
    "condominiumIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "root_notification_scopes_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "user_notification_preferences_userId_idx" ON "user_notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preferences_userId_type_key" ON "user_notification_preferences"("userId", "type");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_type_aggregateUntil_idx" ON "notifications"("userId", "type", "aggregateUntil");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_notification_scopes" ADD CONSTRAINT "root_notification_scopes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
