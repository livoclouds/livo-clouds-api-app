-- Phase B: Configurable per-condominium bank statement column mapping.
-- Each condominium can define one or more BankProfile rows; each profile
-- carries the list of canonical fields (date, charges, credits, balance,
-- description, ...) and their accepted column aliases for Excel and PDF.
-- ImportBatch records which profile parsed it (nullable so we can SetNull
-- when a profile is deleted without orphaning the audit trail).

CREATE TABLE "bank_profiles" (
  "id"             TEXT         NOT NULL,
  "condominiumId"  TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "bankName"       TEXT,
  "isDefault"      BOOLEAN      NOT NULL DEFAULT false,
  "isActive"       BOOLEAN      NOT NULL DEFAULT true,
  "useSameForPdf"  BOOLEAN      NOT NULL DEFAULT true,
  "excelAliases"   JSONB        NOT NULL,
  "pdfAliases"     JSONB        NOT NULL DEFAULT '[]',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,

  CONSTRAINT "bank_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_profiles_condominiumId_name_key"
  ON "bank_profiles"("condominiumId", "name");

CREATE INDEX "bank_profiles_condominiumId_isActive_idx"
  ON "bank_profiles"("condominiumId", "isActive");

CREATE INDEX "bank_profiles_condominiumId_isDefault_idx"
  ON "bank_profiles"("condominiumId", "isDefault");

ALTER TABLE "bank_profiles"
  ADD CONSTRAINT "bank_profiles_condominiumId_fkey"
  FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_batches"
  ADD COLUMN "bankProfileId" TEXT;

CREATE INDEX "import_batches_bankProfileId_idx"
  ON "import_batches"("bankProfileId");

ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_bankProfileId_fkey"
  FOREIGN KEY ("bankProfileId") REFERENCES "bank_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: create a "Default" BankProfile for every existing condominium,
-- mirroring the previously-hardcoded COLUMN_ALIASES used by the Excel and
-- PDF parsers. This guarantees zero-downtime: any condominium that imports
-- after the migration immediately resolves to its own profile and falls
-- back to the legacy alias set.
INSERT INTO "bank_profiles" (
  "id", "condominiumId", "name", "bankName",
  "isDefault", "isActive", "useSameForPdf",
  "excelAliases", "pdfAliases",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::TEXT,
  c."id",
  'Default',
  NULL,
  true,
  true,
  true,
  '[
    {"key":"date","label":"Fecha","system":true,"required":true,"aliases":["fecha movimiento","fecha","date","fecha operación","fecha valor"]},
    {"key":"description","label":"Descripción","system":true,"required":true,"aliases":["descripción","descripcion","concepto","description"]},
    {"key":"charges","label":"Cargos","system":true,"required":true,"aliases":["cargos","cargo","débito","debito","charges","retiros"]},
    {"key":"credits","label":"Abonos","system":true,"required":true,"aliases":["abonos","abono","crédito","credito","credits","depósitos","depositos"]},
    {"key":"balance","label":"Saldo","system":true,"required":true,"aliases":["saldo","balance"]},
    {"key":"transactionNumber","label":"Número","system":false,"required":false,"aliases":["no.","núm.","número","num.","num","#"]},
    {"key":"time","label":"Hora","system":false,"required":false,"aliases":["hora","hour","time"]},
    {"key":"receipt","label":"Recibo","system":false,"required":false,"aliases":["recibo","folio","receipt","referencia","ref"]}
  ]'::JSONB,
  '[]'::JSONB,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "condominiums" c
WHERE NOT EXISTS (
  SELECT 1 FROM "bank_profiles" bp WHERE bp."condominiumId" = c."id"
);
