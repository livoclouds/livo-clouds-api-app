-- CreateEnum
CREATE TYPE "ArcoLegalBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTEREST', 'PUBLIC_TASK', 'LEGITIMATE_INTEREST');

-- CreateEnum
CREATE TYPE "ArcoIdentityVerificationMethod" AS ENUM ('GOVERNMENT_ID', 'PASSPORT', 'CURP', 'AGENT_NOTARIZED', 'OTHER');

-- CreateEnum
CREATE TYPE "ArcoRequesterIdType" AS ENUM ('INE', 'PASSPORT', 'CURP', 'OTHER');

-- CreateEnum
CREATE TYPE "ArcoRequesterRelationship" AS ENUM ('SELF', 'LEGAL_AGENT', 'AUTHORIZED_REPRESENTATIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArcoRequestEventType" ADD VALUE 'OVERDUE';
ALTER TYPE "ArcoRequestEventType" ADD VALUE 'ESCALATED_BY_SYSTEM';
ALTER TYPE "ArcoRequestEventType" ADD VALUE 'NOTIFIED';
ALTER TYPE "ArcoRequestEventType" ADD VALUE 'RETENTION_PURGE';

-- AlterEnum
ALTER TYPE "ArcoRequestStatus" ADD VALUE 'PENDING_VERIFICATION';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ARCO_OVERDUE';

-- AlterTable
ALTER TABLE "arco_requests" ADD COLUMN     "identityVerificationMethod" "ArcoIdentityVerificationMethod",
ADD COLUMN     "identityVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "identityVerifiedBy" TEXT,
ADD COLUMN     "legalBasis" "ArcoLegalBasis",
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requesterIdNumberMasked" TEXT,
ADD COLUMN     "requesterIdType" "ArcoRequesterIdType",
ADD COLUMN     "requesterName" TEXT,
ADD COLUMN     "requesterRelationship" "ArcoRequesterRelationship";

-- AlterTable
ALTER TABLE "condominium_settings" ADD COLUMN     "arcoRetentionMonths" INTEGER NOT NULL DEFAULT 0;
