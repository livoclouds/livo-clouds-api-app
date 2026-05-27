-- AlterTable: add logo audit fields to condominium_settings
ALTER TABLE "condominium_settings" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);
ALTER TABLE "condominium_settings" ADD COLUMN "logoUpdatedByName" TEXT;
