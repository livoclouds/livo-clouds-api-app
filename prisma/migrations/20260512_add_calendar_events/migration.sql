-- Add calendar events module.
-- Supports condominium-scoped operational events: terrace bookings, assemblies,
-- council meetings, maintenance, providers, and general events.

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('TERRACE_BOOKING', 'ASSEMBLY', 'COUNCIL_MEETING', 'MAINTENANCE', 'PROVIDER', 'GENERAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventType" "EventType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "unitNumber" TEXT,
    "residentId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_idx" ON "calendar_events"("condominiumId");

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_startDate_endDate_idx" ON "calendar_events"("condominiumId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_eventType_idx" ON "calendar_events"("condominiumId", "eventType");

-- CreateIndex
CREATE INDEX "calendar_events_deletedAt_idx" ON "calendar_events"("deletedAt");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
