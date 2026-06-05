// Article slugs are owned by the web repo (they are i18n content keys). The API
// never keeps a whitelist — it only validates the *shape* of a slug so garbage
// or injection attempts can't create metric rows. Metric rows are created lazily
// on first view/feedback for any well-formed, previously-unseen slug.
export const SUPPORT_SLUG_MAX = 160;
export const SUPPORT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSupportSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SUPPORT_SLUG_MAX &&
    SUPPORT_SLUG_PATTERN.test(value)
  );
}
