-- Add per-user dashboard onboarding tour state. The tour is shown once
-- automatically on the first dashboard visit; its progress is stored here so it
-- survives cookie/localStorage clears and follows the user across devices.
-- onboardingStep records the last step reached while IN_PROGRESS, letting the
-- tour resume where it was left. completedAt / skippedAt are sealed when the
-- user finishes or explicitly skips the tour.

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingSkippedAt" TIMESTAMP(3);
