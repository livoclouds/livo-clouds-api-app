-- Add terrace booking settings to condominium_settings
ALTER TABLE "condominium_settings"
  ADD COLUMN "terraceBookingEnabled"        BOOLEAN         NOT NULL DEFAULT true,
  ADD COLUMN "terraceRentalAmount"          DECIMAL(12, 2)  NOT NULL DEFAULT 1500,
  ADD COLUMN "terraceSecurityDepositAmount" DECIMAL(12, 2)  NOT NULL DEFAULT 1000,
  ADD COLUMN "terraceDefaultStartTime"      TEXT            NOT NULL DEFAULT '10:00',
  ADD COLUMN "terraceDefaultEndTime"        TEXT            NOT NULL DEFAULT '11:00';
