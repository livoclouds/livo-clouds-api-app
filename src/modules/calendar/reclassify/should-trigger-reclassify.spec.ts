import { EventStatus, EventType } from '@prisma/client';
import {
  shouldTriggerReclassifyOnCreate,
  shouldTriggerReclassifyOnDelete,
  shouldTriggerReclassifyOnUpdate,
  toTerraceTriggerSnapshot,
  type TerraceTriggerSnapshot,
} from './should-trigger-reclassify';
import {
  TERRACE_BOOKING_DEFAULTS,
  type TerraceBookingMetadata,
} from '../terrace-metadata.validator';

const CONDOMINIUM_ID = 'cond-1';
const EVENT_ID = 'evt-1';
const DAY_MS = 24 * 60 * 60 * 1000;

// CAL-034: windows are snapped to UTC-day bounds so the batch query is a
// superset of the matcher's UTC-day-inclusive candidate window.
function startOfUtcDay(d: Date): number {
  const out = new Date(d.getTime());
  out.setUTCHours(0, 0, 0, 0);
  return out.getTime();
}
function endOfUtcDay(d: Date): number {
  const out = new Date(d.getTime());
  out.setUTCHours(23, 59, 59, 999);
  return out.getTime();
}

function metadata(overrides: Partial<TerraceBookingMetadata> = {}): TerraceBookingMetadata {
  return { ...TERRACE_BOOKING_DEFAULTS, ...overrides };
}

function snapshot(overrides: Partial<TerraceTriggerSnapshot> = {}): TerraceTriggerSnapshot {
  return {
    eventType: EventType.TERRACE_BOOKING,
    status: EventStatus.PENDING,
    startDate: new Date('2026-06-15T10:00:00Z'),
    residentId: 'res-1',
    unitNumber: '101',
    metadata: metadata(),
    ...overrides,
  };
}

describe('shouldTriggerReclassifyOnCreate', () => {
  it('emits when a live TERRACE_BOOKING is created with a day-normalized 30-day window', () => {
    const after = snapshot();
    const trigger = shouldTriggerReclassifyOnCreate(CONDOMINIUM_ID, after, EVENT_ID);
    expect(trigger).not.toBeNull();
    expect(trigger!.condominiumId).toBe(CONDOMINIUM_ID);
    expect(trigger!.triggeringEventId).toBe(EVENT_ID);
    expect(trigger!.windowEnd.getTime()).toBe(endOfUtcDay(after.startDate));
    expect(trigger!.windowStart.getTime()).toBe(
      startOfUtcDay(new Date(after.startDate.getTime() - 30 * DAY_MS)),
    );
    expect(trigger!.reason).toBe('create');
  });

  it('snaps the window to UTC-day bounds so boundary-day batches are not missed (CAL-034)', () => {
    // startDate at 10:00 UTC → window must end at 23:59:59.999 of that day and
    // start at 00:00:00.000 of the day 30 days earlier.
    const after = snapshot({ startDate: new Date('2026-06-15T10:00:00Z') });
    const trigger = shouldTriggerReclassifyOnCreate(CONDOMINIUM_ID, after, EVENT_ID);
    expect(trigger!.windowEnd.toISOString()).toBe('2026-06-15T23:59:59.999Z');
    expect(trigger!.windowStart.toISOString()).toBe('2026-05-16T00:00:00.000Z');
  });

  it('does not emit for a non-terrace event', () => {
    const after = snapshot({ eventType: EventType.GENERAL, metadata: null });
    expect(shouldTriggerReclassifyOnCreate(CONDOMINIUM_ID, after, EVENT_ID)).toBeNull();
  });

  it('does not emit when the new TERRACE_BOOKING is already CANCELLED', () => {
    const after = snapshot({ status: EventStatus.CANCELLED });
    expect(shouldTriggerReclassifyOnCreate(CONDOMINIUM_ID, after, EVENT_ID)).toBeNull();
  });
});

describe('shouldTriggerReclassifyOnDelete', () => {
  it('emits when a live TERRACE_BOOKING is removed', () => {
    const before = snapshot();
    const trigger = shouldTriggerReclassifyOnDelete(CONDOMINIUM_ID, before, EVENT_ID);
    expect(trigger).not.toBeNull();
    expect(trigger!.reason).toBe('delete');
    expect(trigger!.windowStart.getTime()).toBe(
      startOfUtcDay(new Date(before.startDate.getTime() - 30 * DAY_MS)),
    );
  });

  it('does not emit when the deleted event was already CANCELLED', () => {
    const before = snapshot({ status: EventStatus.CANCELLED });
    expect(shouldTriggerReclassifyOnDelete(CONDOMINIUM_ID, before, EVENT_ID)).toBeNull();
  });

  it('does not emit when removing a non-terrace event', () => {
    const before = snapshot({ eventType: EventType.GENERAL, metadata: null });
    expect(shouldTriggerReclassifyOnDelete(CONDOMINIUM_ID, before, EVENT_ID)).toBeNull();
  });
});

describe('shouldTriggerReclassifyOnUpdate', () => {
  it('returns null when both before and after are non-terrace', () => {
    const before = snapshot({ eventType: EventType.GENERAL, metadata: null });
    const after = snapshot({ eventType: EventType.GENERAL, metadata: null });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).toBeNull();
  });

  it('emits when eventType flips MEETING → TERRACE_BOOKING using after.window', () => {
    const before = snapshot({ eventType: EventType.GENERAL, metadata: null });
    const after = snapshot({ eventType: EventType.TERRACE_BOOKING });
    const trigger = shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID);
    expect(trigger).not.toBeNull();
    expect(trigger!.windowEnd.getTime()).toBe(endOfUtcDay(after.startDate));
    expect(trigger!.reason).toBe('update:flipToTerrace');
  });

  it('emits when eventType flips TERRACE_BOOKING → MEETING using before.window', () => {
    const before = snapshot();
    const after = snapshot({ eventType: EventType.GENERAL, metadata: null });
    const trigger = shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID);
    expect(trigger).not.toBeNull();
    expect(trigger!.reason).toBe('update:flipFromTerrace');
  });

  it('emits when terraceRentalAmount changes; window is union of before/after', () => {
    const before = snapshot({ metadata: metadata({ terraceRentalAmount: 1500 }) });
    const after = snapshot({ metadata: metadata({ terraceRentalAmount: 3000 }) });
    const trigger = shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID);
    expect(trigger).not.toBeNull();
    expect(trigger!.reason).toBe('update:metadata');
  });

  it('emits when startDate changes; window covers both', () => {
    const before = snapshot({ startDate: new Date('2026-06-10T10:00:00Z') });
    const after = snapshot({ startDate: new Date('2026-07-01T10:00:00Z') });
    const trigger = shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID);
    expect(trigger).not.toBeNull();
    expect(trigger!.windowStart.getTime()).toBe(
      startOfUtcDay(new Date(before.startDate.getTime() - 30 * DAY_MS)),
    );
    expect(trigger!.windowEnd.getTime()).toBe(endOfUtcDay(after.startDate));
  });

  it('emits when residentId changes', () => {
    const before = snapshot({ residentId: 'res-1' });
    const after = snapshot({ residentId: 'res-2' });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).not.toBeNull();
  });

  it('emits when unitNumber changes', () => {
    const before = snapshot({ unitNumber: '101' });
    const after = snapshot({ unitNumber: '202' });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).not.toBeNull();
  });

  it('emits when paymentStatus flips PAID → PENDING (re-opens candidacy)', () => {
    const before = snapshot({ metadata: metadata({ paymentStatus: 'PAID' }) });
    const after = snapshot({ metadata: metadata({ paymentStatus: 'PENDING' }) });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).not.toBeNull();
  });

  it('does not emit when customKeywords order changes but the set is the same', () => {
    const before = snapshot({ metadata: metadata({ customKeywords: ['salon', 'kiosko'] }) });
    const after = snapshot({ metadata: metadata({ customKeywords: ['kiosko', 'salon'] }) });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).toBeNull();
  });

  it('emits when customKeywords gain a new entry', () => {
    const before = snapshot({ metadata: metadata({ customKeywords: ['salon'] }) });
    const after = snapshot({ metadata: metadata({ customKeywords: ['salon', 'kiosko'] }) });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).not.toBeNull();
  });

  it('does not emit for non-material-only changes (notes, post-event, deposit)', () => {
    const before = snapshot({
      metadata: metadata({
        setupNotes: 'before',
        postEventReviewed: false,
        damagesReported: false,
        depositDeductionAmount: 0,
      }),
    });
    const after = snapshot({
      metadata: metadata({
        setupNotes: 'after',
        postEventReviewed: true,
        damagesReported: true,
        depositDeductionAmount: 500,
      }),
    });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).toBeNull();
  });

  it('emits when status transitions to CANCELLED', () => {
    const before = snapshot({ status: EventStatus.PENDING });
    const after = snapshot({ status: EventStatus.CANCELLED });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).not.toBeNull();
  });

  it('does not emit when both sides are CANCELLED', () => {
    const before = snapshot({ status: EventStatus.CANCELLED });
    const after = snapshot({
      status: EventStatus.CANCELLED,
      metadata: metadata({ terraceRentalAmount: 9999 }),
    });
    expect(shouldTriggerReclassifyOnUpdate(CONDOMINIUM_ID, before, after, EVENT_ID)).toBeNull();
  });
});

describe('toTerraceTriggerSnapshot', () => {
  it('parses TERRACE_BOOKING metadata into a typed object', () => {
    const snap = toTerraceTriggerSnapshot({
      id: 'e1',
      eventType: EventType.TERRACE_BOOKING,
      status: EventStatus.PENDING,
      startDate: '2026-06-15T10:00:00Z',
      residentId: 'res-1',
      unitNumber: '101',
      metadata: { ...TERRACE_BOOKING_DEFAULTS, terraceRentalAmount: 2000 },
    });
    expect(snap.metadata).not.toBeNull();
    expect(snap.metadata!.terraceRentalAmount).toBe(2000);
    expect(snap.startDate.toISOString()).toBe('2026-06-15T10:00:00.000Z');
  });

  it('returns null metadata for non-terrace events even if a JSON blob is present', () => {
    const snap = toTerraceTriggerSnapshot({
      eventType: EventType.GENERAL,
      status: EventStatus.PENDING,
      startDate: new Date('2026-06-15T10:00:00Z'),
      residentId: null,
      unitNumber: null,
      metadata: { foo: 'bar' },
    });
    expect(snap.metadata).toBeNull();
  });
});
