import { isValidIanaTimezone } from '../calendar/timezone.util';

/**
 * Business-hours utility for the WhatsApp bot pipeline (Phase 4).
 *
 * The condominium business-hours value is stored on `CondominiumSettings.businessHours`
 * (a Json column that holds the project's existing string form, e.g.
 * "Mon–Fri 09:00–18:00" produced by the web BusinessHoursPicker). When the value
 * is missing, empty, or unparseable the bot treats the condominium as always
 * open — no off-hours postfix is appended. This keeps behavior safe for
 * condominiums that have not configured business hours yet.
 */

const DEFAULT_TIMEZONE = 'America/Monterrey';

/** Maps short/long day names (English + Spanish) to a Monday-first index 0..6. */
const DAY_ALIASES: Record<string, number> = {
  mon: 0, monday: 0, lun: 0, lunes: 0,
  tue: 1, tues: 1, tuesday: 1, mar: 1, martes: 1,
  wed: 2, wednesday: 2, mie: 2, miercoles: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, jue: 3, jueves: 3,
  fri: 4, friday: 4, vie: 4, viernes: 4,
  sat: 5, saturday: 5, sab: 5, sabado: 5,
  sun: 6, sunday: 6, dom: 6, domingo: 6,
};

export interface ParsedBusinessHours {
  /** Monday-first weekday indexes (0 = Monday … 6 = Sunday). */
  daysSet: Set<number>;
  /** Opening time as minutes from midnight. */
  startMinutes: number;
  /** Closing time as minutes from midnight. */
  endMinutes: number;
}

export interface NextBusinessWindow {
  nextDay: string;
  nextTime: string;
}

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parseDays(dayPart: string): Set<number> {
  const set = new Set<number>();
  if (/(daily|everyday|every\s*day|all\s*days|todos\s*los\s*dias|diario)/.test(dayPart)) {
    for (let i = 0; i < 7; i++) set.add(i);
    return set;
  }

  const tokens = dayPart.split(/[^a-z]+/).filter(Boolean);
  const dayIndexes: number[] = [];
  for (const token of tokens) {
    const index = DAY_ALIASES[token];
    if (index !== undefined) dayIndexes.push(index);
  }
  if (dayIndexes.length === 0) return set;

  const isRange =
    dayIndexes.length === 2 && /[-–—]|\bto\b|\ba\b/.test(dayPart);
  if (isRange) {
    let cursor = dayIndexes[0];
    set.add(cursor);
    while (cursor !== dayIndexes[1]) {
      cursor = (cursor + 1) % 7;
      set.add(cursor);
    }
  } else {
    for (const index of dayIndexes) set.add(index);
  }
  return set;
}

/**
 * Parses the project's business-hours string form. Returns `null` for empty,
 * non-string, or unparseable input so callers can fall back to "always open".
 */
export function parseBusinessHours(raw: unknown): ParsedBusinessHours | null {
  if (typeof raw !== 'string') return null;
  const text = stripDiacritics(raw).trim().toLowerCase();
  if (!text || text === '{}') return null;

  const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!timeMatch) return null;

  const startMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  const endMinutes = Number(timeMatch[3]) * 60 + Number(timeMatch[4]);
  if (
    startMinutes < 0 ||
    endMinutes > 24 * 60 ||
    startMinutes >= endMinutes
  ) {
    return null;
  }

  const dayPart = text.slice(0, timeMatch.index ?? 0).trim();
  const daysSet = parseDays(dayPart);
  if (daysSet.size === 0) return null;

  return { daysSet, startMinutes, endMinutes };
}

/** Reads the Monday-first weekday index and minutes-of-day for `date` in `tz`. */
function getLocalParts(
  date: Date,
  tz: string,
): { weekdayIndex: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  if (hour === 24) hour = 0;

  return {
    weekdayIndex: DAY_ALIASES[weekday.toLowerCase()] ?? 0,
    minutes: hour * 60 + minute,
  };
}

function formatMinutes(minutes: number): string {
  const hh = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mm = (minutes % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * Returns true when `now` falls inside the configured business hours for `tz`.
 * Missing / unparseable business hours are treated as always open (returns true).
 */
export function isWithinBusinessHours(
  now: Date,
  raw: unknown,
  tz: string,
): boolean {
  const parsed = parseBusinessHours(raw);
  if (!parsed) return true;

  const zone = isValidIanaTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const { weekdayIndex, minutes } = getLocalParts(now, zone);
  return (
    parsed.daysSet.has(weekdayIndex) &&
    minutes >= parsed.startMinutes &&
    minutes < parsed.endMinutes
  );
}

/**
 * Computes the next business window opening relative to `now`. Skips
 * non-business days. Returns `null` when business hours are missing/unparseable.
 * `nextDay` is localized (defaults to es-MX to match the Spanish default
 * off-hours message); `nextTime` is the opening time formatted as HH:MM.
 */
export function getNextBusinessWindow(
  now: Date,
  raw: unknown,
  tz: string,
  locale = 'es-MX',
): NextBusinessWindow | null {
  const parsed = parseBusinessHours(raw);
  if (!parsed) return null;

  const zone = isValidIanaTimezone(tz) ? tz : DEFAULT_TIMEZONE;

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now.getTime() + offset * 86_400_000);
    const { weekdayIndex, minutes } = getLocalParts(candidate, zone);
    if (!parsed.daysSet.has(weekdayIndex)) continue;
    // Today only counts if the window has not opened yet.
    if (offset === 0 && minutes >= parsed.startMinutes) continue;

    const nextDay = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      weekday: 'long',
    }).format(candidate);

    return {
      nextDay: capitalize(nextDay),
      nextTime: formatMinutes(parsed.startMinutes),
    };
  }
  return null;
}

/**
 * Substitutes the {{nextDay}} and {{nextTime}} placeholders in an off-hours
 * message template. Both placeholders are optional in the template.
 */
export function renderOffHoursMessage(
  template: string,
  vars: NextBusinessWindow,
): string {
  return template
    .replace(/\{\{\s*nextDay\s*\}\}/gi, vars.nextDay)
    .replace(/\{\{\s*nextTime\s*\}\}/gi, vars.nextTime);
}
