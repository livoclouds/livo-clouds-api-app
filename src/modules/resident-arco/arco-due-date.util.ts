// LFPDPPP legal response window for an ARCO request: 20 business days. Kept as a
// tunable constant. Mexican bank holidays are NOT yet skipped (weekends only) —
// see TODO below; that refinement can land later without changing the contract.
export const ARCO_RESPONSE_BUSINESS_DAYS = 20;

// Adds `businessDays` to `from`, skipping Saturdays and Sundays. Returns a new
// Date (does not mutate the input). Pure — no timezone math beyond the UTC date
// the caller passes; the deadline is a whole-day boundary.
//
// TODO(2F+): also skip Mexican public/bank holidays (a holidays table exists on
// the web; the API would need its own list).
export function computeArcoDueDate(
  from: Date,
  businessDays: number = ARCO_RESPONSE_BUSINESS_DAYS,
): Date {
  const due = new Date(from.getTime());
  let remaining = Math.max(0, Math.floor(businessDays));
  // UTC-based so the deadline is deterministic regardless of server timezone.
  while (remaining > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    const day = due.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return due;
}
