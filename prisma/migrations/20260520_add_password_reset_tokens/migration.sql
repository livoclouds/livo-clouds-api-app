-- Phase 6: Password reset token store for the forgot-password / reset-password flow.
-- tokenHash stores SHA-256(rawToken) — the raw token is never persisted.
-- usedAt is null until a successful reset; enforces single-use semantics.
-- Tokens expire after 30 minutes (enforced in AuthService.resetPassword).
CREATE TABLE "password_reset_tokens" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "tokenHash" TEXT         NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key"
  ON "password_reset_tokens"("tokenHash");

CREATE INDEX "password_reset_tokens_userId_idx"
  ON "password_reset_tokens"("userId");

CREATE INDEX "password_reset_tokens_expiresAt_idx"
  ON "password_reset_tokens"("expiresAt");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
