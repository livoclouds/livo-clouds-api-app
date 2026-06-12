/**
 * Terrace booking ↔ transaction matching, end-to-end (CAL-007 + CAL-022).
 *
 * Exercises the full chain against a REAL Postgres:
 *   PENDING terrace booking → import batch classification (terrace pass) →
 *   matchedCalendarEventId / AUTO_TERRACE_BOOKING → reconciliation approve →
 *   booking metadata paymentStatus PAID → reopen → PENDING revert.
 *
 * Also CHARACTERIZES today's known gaps (finding IDs inline):
 *   CAL-003 — two same-amount transactions both link to the same booking.
 *   CAL-005 — reopening either payer reverts the booking, no APPROVED-guard.
 *   CAL-012 — security-deposit amounts are not modeled and never match.
 */
import { FlowType, EventStatus, EventType, Prisma } from '@prisma/client';

import {
  closePipelineContext,
  createPipelineContext,
  describeIntegration,
  PipelineContext,
  resetDb,
} from './db';

// Mid-month transaction date keeps the month bucket stable in any timezone;
// the event sits 5 days later, comfortably inside the 30-day match window.
const TX_DATE = new Date('2026-03-15');
const EVENT_START = new Date('2026-03-20T18:00:00.000Z');
const EVENT_END = new Date('2026-03-20T22:00:00.000Z');

const RENTAL_AMOUNT = 1500;
const DEPOSIT_AMOUNT = 1000;

// Carries every signal the matcher can use: terrace keyword + unit 101
// (→ resident via the padrón) → resident + unit signals → AUTO @ 0.95.
const MATCHING_DESCRIPTION = 'PAGO RESERVA TERRAZA CASA 101';

interface TerraceFixture {
  condominiumId: string;
  userId: string;
  residentId: string;
  batchId: string;
}

async function seedTerraceFixture(ctx: PipelineContext): Promise<TerraceFixture> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug: `terrace-${Date.now()}`, name: 'Terrace IT Condo' },
  });

  // totalUnits must cover unit 101 — the extractor range-validates captures.
  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 200 },
  });

  const user = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `importer-${condo.id}@example.test`,
      passwordHash: 'x',
      firstName: 'Imp',
      lastName: 'Orter',
    },
  });

  // bankName/dialect left at defaults → GENERIC text extraction, so the
  // maintenance amount-gate (BanBajío-only) never interferes.
  const bankProfile = await prisma.bankProfile.create({
    data: { condominiumId: condo.id, name: 'Generic', excelAliases: {} },
  });

  const resident = await prisma.resident.create({
    data: {
      condominiumId: condo.id,
      unitNumber: '101',
      unitNumberNormalized: '101',
      firstName: 'Ana',
      lastName: 'García',
    },
  });

  const batch = await prisma.importBatch.create({
    data: {
      condominiumId: condo.id,
      importedById: user.id,
      bankProfileId: bankProfile.id,
      fileName: 'estado-marzo.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 1024,
      fileHash: `hash-${condo.id}`,
    },
  });

  return {
    condominiumId: condo.id,
    userId: user.id,
    residentId: resident.id,
    batchId: batch.id,
  };
}

function terraceMetadata(overrides: Record<string, unknown> = {}): Prisma.InputJsonValue {
  return {
    terraceRentalAmount: RENTAL_AMOUNT,
    securityDepositAmount: DEPOSIT_AMOUNT,
    paymentStatus: 'PENDING',
    securityDepositStatus: 'PENDING',
    contractSigned: false,
    guestParkingRequested: false,
    setupNotes: '',
    customKeywords: [],
    ...overrides,
  };
}

/** Seeds a TERRACE_BOOKING row directly (fixture concern, not CalendarService). */
async function seedBooking(
  ctx: PipelineContext,
  fx: TerraceFixture,
  overrides: {
    status?: EventStatus;
    startDate?: Date;
    endDate?: Date;
    metadata?: Prisma.InputJsonValue;
  } = {},
): Promise<{ id: string }> {
  return ctx.prisma.calendarEvent.create({
    data: {
      condominiumId: fx.condominiumId,
      createdById: fx.userId,
      title: 'Reservación Terraza',
      eventType: EventType.TERRACE_BOOKING,
      status: overrides.status ?? EventStatus.PENDING,
      startDate: overrides.startDate ?? EVENT_START,
      endDate: overrides.endDate ?? EVENT_END,
      unitNumber: '101',
      residentId: fx.residentId,
      metadata: overrides.metadata ?? terraceMetadata(),
    },
    select: { id: true },
  });
}

async function seedIncomeTransactions(
  ctx: PipelineContext,
  fx: TerraceFixture,
  rows: Array<{ description: string; credits: number }>,
): Promise<void> {
  await ctx.prisma.transaction.createMany({
    data: rows.map((row, i) => ({
      condominiumId: fx.condominiumId,
      importBatchId: fx.batchId,
      transactionDate: TX_DATE,
      description: row.description,
      credits: row.credits,
      balance: (i + 1) * row.credits,
      flowType: FlowType.INCOME,
    })),
  });
}

async function readPaymentStatus(ctx: PipelineContext, eventId: string): Promise<string> {
  const event = await ctx.prisma.calendarEvent.findUniqueOrThrow({
    where: { id: eventId },
    select: { metadata: true },
  });
  return (event.metadata as { paymentStatus: string }).paymentStatus;
}

describeIntegration('terrace booking matching (integration)', () => {
  let ctx: PipelineContext;
  let fx: TerraceFixture;

  beforeAll(async () => {
    ctx = await createPipelineContext();
  });

  afterAll(async () => {
    if (ctx) await closePipelineContext(ctx);
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    fx = await seedTerraceFixture(ctx);
  });

  it('links a matching INCOME row to the booking and marks it PAID on approval', async () => {
    const booking = await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(tx.matchedCalendarEventId).toBe(booking.id);
    expect(tx.matchSource).toBe('AUTO_TERRACE_BOOKING');
    // Resident + unit signals fired → strongest tier, auto-classified.
    expect(tx.classificationStatus).toBe('AUTO');
    expect(tx.residentId).toBe(fx.residentId);
    expect(tx.paymentConcept).toBe('AMENITY');
    expect(Number(tx.confidenceScore)).toBeCloseTo(0.95, 5);

    // Approval drives the terrace side effect: booking metadata flips to PAID.
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PENDING'); // precondition
    await ctx.reconciliation.approveTransaction(fx.condominiumId, tx.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID');
  });

  it('two equally-strong PENDING bookings tie → TERRACE_AMBIGUOUS, no link', async () => {
    // Same amount, same unit/resident, both event dates inside the 30-day
    // window after TX_DATE → identical signal score → ambiguity.
    await seedBooking(ctx, fx, {
      startDate: new Date('2026-03-20T18:00:00.000Z'),
      endDate: new Date('2026-03-20T22:00:00.000Z'),
    });
    await seedBooking(ctx, fx, {
      startDate: new Date('2026-03-25T18:00:00.000Z'),
      endDate: new Date('2026-03-25T22:00:00.000Z'),
    });
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(tx.matchedCalendarEventId).toBeNull();
    expect(tx.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(tx.classificationStatus).toBe('NEEDS_REVIEW');
    expect(tx.requiresReviewReason).toBe('TERRACE_AMBIGUOUS');
  });

  it('a CANCELLED booking never matches', async () => {
    await seedBooking(ctx, fx, { status: EventStatus.CANCELLED });
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    // No candidate set → the terrace pass never fires; later passes may still
    // classify the row (unit 101 → resident), but never against the booking.
    expect(tx.matchedCalendarEventId).toBeNull();
    expect(tx.matchSource).not.toBe('AUTO_TERRACE_BOOKING');
  });

  it('CHARACTERIZATION: two same-amount rows in one batch both link to the SAME booking', async () => {
    // CAL-003: the candidate list is loaded once per classifyBatch and a match
    // does not consume the booking, so a duplicate payment links to the same
    // event instead of being flagged. Phase 3 will surface this.
    const booking = await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const txs = await ctx.prisma.transaction.findMany({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
      orderBy: { balance: 'asc' },
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].matchedCalendarEventId).toBe(booking.id);
    expect(txs[1].matchedCalendarEventId).toBe(booking.id); // CAL-003
  });

  it('CHARACTERIZATION: reopening the second payer reverts the booking even though the first still pays it', async () => {
    // CAL-005: no APPROVED-guard / other-payer check — Phase 3. unmark only
    // looks at the booking's own paymentStatus, never at which transaction's
    // approval set it, so the booking ends PENDING while an APPROVED payment
    // for it still exists.
    const booking = await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const [first, second] = await ctx.prisma.transaction.findMany({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
      orderBy: { balance: 'asc' },
    });

    await ctx.reconciliation.approveTransaction(fx.condominiumId, first.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID');

    // Second approval is silently absorbed (CAL-003) — booking stays PAID.
    await ctx.reconciliation.approveTransaction(fx.condominiumId, second.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID');

    // Reopen ONLY the second payer: the booking reverts to PENDING although
    // the first transaction is still APPROVED and still covers it. // CAL-005
    await ctx.reconciliation.reopenTransaction(fx.condominiumId, second.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PENDING');

    const firstAfter = await ctx.prisma.transaction.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(firstAfter.reconciliationStatus).toBe('APPROVED');
  });

  it('CHARACTERIZATION: a deposit-amount transaction does NOT match', async () => {
    // CAL-012: only terraceRentalAmount participates in matching — security
    // deposits have no modeled payment path, so a deposit-sized INCOME row
    // (1000 ≠ 1500) fails the amount filter and never links to the booking.
    await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: DEPOSIT_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(tx.matchedCalendarEventId).toBeNull(); // CAL-012
    expect(tx.matchSource).not.toBe('AUTO_TERRACE_BOOKING');
  });
});
