import {
  isMexicanHoliday,
  mexicanHolidaysForYear,
  MX_HOLIDAY_OVERRIDES,
  nthWeekdayOfMonth,
} from './mx-holidays.util';

describe('nthWeekdayOfMonth', () => {
  it('computes the nth weekday of a month (UTC)', () => {
    // 1st Monday of February 2026 = Feb 2.
    expect(nthWeekdayOfMonth(2026, 1, 1, 1).toISOString().slice(0, 10)).toBe('2026-02-02');
    // 3rd Monday of March 2026 = Mar 16.
    expect(nthWeekdayOfMonth(2026, 2, 1, 3).toISOString().slice(0, 10)).toBe('2026-03-16');
    // 3rd Monday of November 2026 = Nov 16.
    expect(nthWeekdayOfMonth(2026, 10, 1, 3).toISOString().slice(0, 10)).toBe('2026-11-16');
  });
});

describe('mexicanHolidaysForYear', () => {
  it('includes the fixed-date art. 74 holidays', () => {
    const h = mexicanHolidaysForYear(2026);
    expect(h.has('2026-01-01')).toBe(true); // New Year
    expect(h.has('2026-05-01')).toBe(true); // Labour Day
    expect(h.has('2026-09-16')).toBe(true); // Independence Day
    expect(h.has('2026-12-25')).toBe(true); // Christmas
  });

  it('includes the computed "nth Monday" holidays', () => {
    const h = mexicanHolidaysForYear(2026);
    expect(h.has('2026-02-02')).toBe(true); // 1st Mon Feb
    expect(h.has('2026-03-16')).toBe(true); // 3rd Mon Mar
    expect(h.has('2026-11-16')).toBe(true); // 3rd Mon Nov
  });

  it('is evergreen — computes a different year correctly', () => {
    const h = mexicanHolidaysForYear(2027);
    expect(h.has('2027-02-01')).toBe(true); // 1st Monday of February 2027
    expect(h.has('2027-03-15')).toBe(true); // 3rd Monday of March 2027
    expect(h.has('2027-09-16')).toBe(true); // Independence Day
  });

  it('includes decreed one-off overrides for their year only', () => {
    expect(MX_HOLIDAY_OVERRIDES).toContain('2024-10-01');
    expect(mexicanHolidaysForYear(2024).has('2024-10-01')).toBe(true);
    expect(mexicanHolidaysForYear(2026).has('2026-10-01')).toBe(false);
  });
});

describe('isMexicanHoliday', () => {
  it('matches holidays and rejects ordinary days', () => {
    expect(isMexicanHoliday(new Date('2026-09-16'))).toBe(true); // Independence Day
    expect(isMexicanHoliday(new Date('2026-02-02'))).toBe(true); // 1st Mon Feb
    expect(isMexicanHoliday(new Date('2026-06-04'))).toBe(false); // ordinary Thursday
  });
});
