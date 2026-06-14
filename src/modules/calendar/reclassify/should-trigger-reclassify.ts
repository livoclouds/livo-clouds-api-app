import { EventStatus, EventType } from '@prisma/client';
import {
  validateTerraceMetadata,
  type TerraceBookingMetadata,
} from '../terrace-metadata.validator';
import type { CalendarTerraceChangedPayload } from '../events/calendar-terrace-changed.event';

// Mirrors the Pass 0.5 window in
// src/modules/classification/terrace-booking-matcher.ts (TERRACE_DATE_WINDOW_DAYS=30).
// Keeping this constant local lets the detector stay a pure function with no
// cross-module import; if the matcher ever changes its window, the matcher and
// the detector must move in lockstep.
const TERRACE_DATE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// CAL-034: the matcher (terrace-booking-matcher.ts) compares against
// `transactionDate` on UTC-day-inclusive bounds, while bank transactions are
// stored at UTC midnight. If the trigger window used exact event timestamps,
// a transaction on the boundary day could fall outside `findAffectedBatches`
// even though the matcher would consider it — so a boundary-day batch would be
// silently missed by auto-reclassify. Snapping windowStart down to the start of
// its UTC day and windowEnd up to the end of its UTC day makes the batch query a
// guaranteed superset of the matcher's candidate window.
function startOfUtcDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function endOfUtcDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCHours(23, 59, 59, 999);
  return out;
}

export interface TerraceTriggerSnapshot {
  eventType: EventType;
  status: EventStatus;
  startDate: Date;
  residentId: string | null;
  unitNumber: string | null;
  metadata: TerraceBookingMetadata | null;
}

export type TriggerCore = Omit<CalendarTerraceChangedPayload, 'action'>;

interface RawCalendarEvent {
  id?: string;
  eventType: EventType;
  status: EventStatus;
  startDate: Date | string;
  residentId: string | null;
  unitNumber: string | null;
  metadata: unknown;
}

export function toTerraceTriggerSnapshot(event: RawCalendarEvent): TerraceTriggerSnapshot {
  let parsedMetadata: TerraceBookingMetadata | null = null;
  if (event.eventType === EventType.TERRACE_BOOKING && event.metadata != null) {
    const result = validateTerraceMetadata(event.metadata);
    if (result.valid) parsedMetadata = result.data;
  }
  return {
    eventType: event.eventType,
    status: event.status,
    startDate: event.startDate instanceof Date ? event.startDate : new Date(event.startDate),
    residentId: event.residentId,
    unitNumber: event.unitNumber,
    metadata: parsedMetadata,
  };
}

function isLiveTerrace(snap: TerraceTriggerSnapshot): boolean {
  return snap.eventType === EventType.TERRACE_BOOKING && snap.status !== EventStatus.CANCELLED;
}

function windowFromStart(startDate: Date): { windowStart: Date; windowEnd: Date } {
  return {
    windowStart: startOfUtcDay(new Date(startDate.getTime() - TERRACE_DATE_WINDOW_DAYS * DAY_MS)),
    windowEnd: endOfUtcDay(startDate),
  };
}

function unionWindow(a: Date, b: Date): { windowStart: Date; windowEnd: Date } {
  const earliest = a.getTime() < b.getTime() ? a : b;
  const latest = a.getTime() > b.getTime() ? a : b;
  return {
    windowStart: startOfUtcDay(new Date(earliest.getTime() - TERRACE_DATE_WINDOW_DAYS * DAY_MS)),
    windowEnd: endOfUtcDay(latest),
  };
}

function normalizedKeywordSet(keywords: string[] | undefined | null): string {
  if (!keywords || keywords.length === 0) return '';
  return [...keywords]
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
    .sort()
    .join('|');
}

function metadataMatchingFieldsChanged(
  before: TerraceBookingMetadata | null,
  after: TerraceBookingMetadata | null,
): boolean {
  if (before === null && after === null) return false;
  if (before === null || after === null) return true;
  if (before.terraceRentalAmount !== after.terraceRentalAmount) return true;
  if (before.paymentStatus !== after.paymentStatus) return true;
  // CAL-058 — the matcher (terrace-booking-matcher.ts) also scores on the
  // security deposit (amount + status), so a deposit-only edit must re-match;
  // otherwise a deposit-sized payment keeps mis-routing until an unrelated edit.
  if (before.securityDepositAmount !== after.securityDepositAmount) return true;
  if (before.securityDepositStatus !== after.securityDepositStatus) return true;
  if (normalizedKeywordSet(before.customKeywords) !== normalizedKeywordSet(after.customKeywords)) {
    return true;
  }
  return false;
}

export function shouldTriggerReclassifyOnCreate(
  condominiumId: string,
  after: TerraceTriggerSnapshot,
  triggeringEventId: string,
): TriggerCore | null {
  if (!isLiveTerrace(after)) return null;
  return {
    condominiumId,
    triggeringEventId,
    reason: 'create',
    ...windowFromStart(after.startDate),
  };
}

export function shouldTriggerReclassifyOnDelete(
  condominiumId: string,
  before: TerraceTriggerSnapshot,
  triggeringEventId: string,
): TriggerCore | null {
  if (!isLiveTerrace(before)) return null;
  return {
    condominiumId,
    triggeringEventId,
    reason: 'delete',
    ...windowFromStart(before.startDate),
  };
}

export function shouldTriggerReclassifyOnUpdate(
  condominiumId: string,
  before: TerraceTriggerSnapshot,
  after: TerraceTriggerSnapshot,
  triggeringEventId: string,
): TriggerCore | null {
  const beforeWasTerrace = before.eventType === EventType.TERRACE_BOOKING;
  const afterIsTerrace = after.eventType === EventType.TERRACE_BOOKING;

  if (!beforeWasTerrace && !afterIsTerrace) return null;

  if (!beforeWasTerrace && afterIsTerrace) {
    if (after.status === EventStatus.CANCELLED) return null;
    return {
      condominiumId,
      triggeringEventId,
      reason: 'update:flipToTerrace',
      ...windowFromStart(after.startDate),
    };
  }

  if (beforeWasTerrace && !afterIsTerrace) {
    if (before.status === EventStatus.CANCELLED) return null;
    return {
      condominiumId,
      triggeringEventId,
      reason: 'update:flipFromTerrace',
      ...windowFromStart(before.startDate),
    };
  }

  // Both are TERRACE_BOOKING — diff matching-relevant fields.
  const startDateChanged = before.startDate.getTime() !== after.startDate.getTime();
  const statusChanged = before.status !== after.status;
  const residentChanged = before.residentId !== after.residentId;
  const unitChanged = (before.unitNumber ?? '') !== (after.unitNumber ?? '');
  const metadataChanged = metadataMatchingFieldsChanged(before.metadata, after.metadata);

  if (!startDateChanged && !statusChanged && !residentChanged && !unitChanged && !metadataChanged) {
    return null;
  }

  // Only matters when transitioning into / out of CANCELLED — both sides
  // CANCELLED means the booking was already excluded from candidacy and stays so.
  if (
    before.status === EventStatus.CANCELLED &&
    after.status === EventStatus.CANCELLED
  ) {
    return null;
  }

  const reasonParts: string[] = [];
  if (startDateChanged) reasonParts.push('startDate');
  if (statusChanged) reasonParts.push('status');
  if (residentChanged) reasonParts.push('residentId');
  if (unitChanged) reasonParts.push('unitNumber');
  if (metadataChanged) reasonParts.push('metadata');
  const reason = `update:${reasonParts.join(',')}`;

  return {
    condominiumId,
    triggeringEventId,
    reason,
    ...unionWindow(before.startDate, after.startDate),
  };
}
