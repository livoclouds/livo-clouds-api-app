/**
 * Minimal catalog of bank identities the classification engine special-cases.
 * Mirrors the web catalog in `src/lib/constants/mexican-banks.ts`. Kept as a
 * plain module (no NestJS DI) so pure functions in other modules can import it
 * without provider wiring or circular-dependency risk.
 */

/** Lowercase + strip diacritics so "BanBajío" and "banbajio" compare equal. */
export function normalizeBankName(bankName: string | null | undefined): string {
  return (bankName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * BanBajío ("Banco del Bajío") — currently the only bank with a custom
 * unit-number extraction path. Matched loosely on the "bajio" stem so it covers
 * "BanBajío", "Banco del Bajío" and free-typed variants.
 */
export function isBanBajio(bankName: string | null | undefined): boolean {
  return normalizeBankName(bankName).includes('bajio');
}
