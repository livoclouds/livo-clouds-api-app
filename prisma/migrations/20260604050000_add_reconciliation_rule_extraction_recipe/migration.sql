-- AlterTable
-- UNIT outcome metadata: the visual block recipe built in the editor's advanced
-- (block-builder) mode. Engine-ignored — classification runs unitExtractionPattern.
ALTER TABLE "reconciliation_rules" ADD COLUMN     "extractionRecipe" JSONB;
