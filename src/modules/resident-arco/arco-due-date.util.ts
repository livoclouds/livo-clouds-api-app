import { isMexicanHoliday } from '../../common/holidays/mx-holidays.util';

// LFPDPPP legal response window for an ARCO request: 20 business days. Kept as a
// tunable constant.
export const ARCO_RESPONSE_BUSINESS_DAYS = 20;

// Adds `businessDays` to `from`, skipping Saturdays, Sundays, and official
// Mexican public holidays (art. 74 LFT — see mx-holidays.util). Returns a new
// Date (does not mutate the input). UTC-based so the deadline is deterministic
// regardless of server timezone; the deadline is a whole-day boundary.
export function computeArcoDueDate(
  from: Date,
  businessDays: number = ARCO_RESPONSE_BUSINESS_DAYS,
): Date {
  const due = new Date(from.getTime());
  let remaining = Math.max(0, Math.floor(businessDays));
  while (remaining > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    const day = due.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6 && !isMexicanHoliday(due)) {
      remaining -= 1;
    }
  }
  return due;
}
