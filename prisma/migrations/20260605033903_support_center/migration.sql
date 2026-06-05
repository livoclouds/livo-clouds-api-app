-- CreateEnum
CREATE TYPE "SupportRequestType" AS ENUM ('TECHNICAL', 'USAGE', 'IMPROVEMENT', 'DATA_ISSUE', 'ADMIN');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupportModule" AS ENUM ('DASHBOARD', 'IMPORTS', 'RECONCILIATION', 'RESIDENTS', 'REPORTS', 'INVENTORY', 'SETTINGS', 'AUTH');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HelpVoteValue" AS ENUM ('HELPFUL', 'NOT_HELPFUL');

-- CreateTable
CREATE TABLE "help_article_metrics" (
    "slug" VARCHAR(160) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "notHelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_article_metrics_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "help_article_votes" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "userId" TEXT NOT NULL,
    "value" "HelpVoteValue" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_article_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestType" "SupportRequestType" NOT NULL,
    "priority" "SupportPriority" NOT NULL,
    "module" "SupportModule" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "screenshotKey" VARCHAR(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "help_article_metrics_viewCount_idx" ON "help_article_metrics"("viewCount");

-- CreateIndex
CREATE INDEX "help_article_votes_userId_idx" ON "help_article_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "help_article_votes_slug_userId_key" ON "help_article_votes"("slug", "userId");

-- CreateIndex
CREATE INDEX "support_tickets_condominiumId_createdAt_idx" ON "support_tickets"("condominiumId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_userId_createdAt_idx" ON "support_tickets"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- AddForeignKey
ALTER TABLE "help_article_votes" ADD CONSTRAINT "help_article_votes_slug_fkey" FOREIGN KEY ("slug") REFERENCES "help_article_metrics"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_article_votes" ADD CONSTRAINT "help_article_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
