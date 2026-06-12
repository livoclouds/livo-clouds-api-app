-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "terraceCandidateEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
