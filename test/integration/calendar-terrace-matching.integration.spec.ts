/**
 * Terrace booking ↔ transaction matching, end-to-end (CAL-007 + CAL-022).
 *
 * Exercises the full chain against a REAL Postgres:
 *   PENDING terrace booking → import batch classification (terrace pass) →
 *   matchedCalendarEventId / AUTO_TERRACE_BOOKING → reconciliation approve →
 *   booking metadata paymentStatus PAID → reopen → PENDING revert.
 *
 * Phase 3 (CAL-003/004/005/012) makes paymentStatus trustworthy; the cases below
 * assert the CORRECTED behavior (the Phase-2 characterizations were flipped here):
 *   CAL-003 — a second same-amount row is flagged TERRACE_DUPLICATE, not double-linked.
 *   CAL-005 — reopening one of several approved payers keeps a still-covered booking PAID.
 *   CAL-012 — deposit-amount (and rental==deposit) payments land in TERRACE_DEPOSIT review.
 *   CAL-004 — a row reclassified away from terrace no longer marks the booking PAID.
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

  it('CAL-003: a second same-amount row in one batch is flagged TERRACE_DUPLICATE, not double-linked', async () => {
    // Phase 3: the engine claims the booking the instant the first row links it,
    // so the second same-amount transaction in the SAME run no longer links to
    // the same event — it lands in review with a dedicated duplicate reason.
    const booking = await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const txs = await ctx.prisma.transaction.findMany({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(txs).toHaveLength(2);
    // Loop order is not guaranteed, so assert on the partition: exactly one row
    // links (AUTO), exactly one is the flagged duplicate (no link).
    const linked = txs.filter((t) => t.matchedCalendarEventId === booking.id);
    const duplicate = txs.filter(
      (t) => t.requiresReviewReason === 'TERRACE_DUPLICATE',
    );
    expect(linked).toHaveLength(1);
    expect(linked[0].classificationStatus).toBe('AUTO');
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].matchedCalendarEventId).toBeNull();
    expect(duplicate[0].classificationStatus).toBe('NEEDS_REVIEW');
    expect(duplicate[0].matchSource).toBe('AUTO_TERRACE_BOOKING');
  });

  it('CAL-005: reopening one of two approved payers keeps the booking PAID while the other still covers it', async () => {
    // Phase 3 other-payer guard. The engine no longer produces two links for one
    // booking, so a legacy double-link is seeded directly: both transactions link
    // the same booking and are approved (→ PAID). Reopening one must NOT revert a
    // booking the other approved payment still covers; reopening the last one does.
    const booking = await seedBooking(ctx, fx);
    await ctx.prisma.transaction.createMany({
      data: [
        {
          condominiumId: fx.condominiumId,
          importBatchId: fx.batchId,
          transactionDate: TX_DATE,
          description: MATCHING_DESCRIPTION,
          credits: RENTAL_AMOUNT,
          balance: RENTAL_AMOUNT,
          flowType: FlowType.INCOME,
          matchedCalendarEventId: booking.id,
          matchSource: 'AUTO_TERRACE_BOOKING',
        },
        {
          condominiumId: fx.condominiumId,
          importBatchId: fx.batchId,
          transactionDate: TX_DATE,
          description: MATCHING_DESCRIPTION,
          credits: RENTAL_AMOUNT,
          balance: 2 * RENTAL_AMOUNT,
          flowType: FlowType.INCOME,
          matchedCalendarEventId: booking.id,
          matchSource: 'AUTO_TERRACE_BOOKING',
        },
      ],
    });

    const [first, second] = await ctx.prisma.transaction.findMany({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
      orderBy: { balance: 'asc' },
    });

    await ctx.reconciliation.approveTransaction(fx.condominiumId, first.id, fx.userId);
    await ctx.reconciliation.approveTransaction(fx.condominiumId, second.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID');

    // Reopen ONE payer — the other is still APPROVED and covers the booking.
    await ctx.reconciliation.reopenTransaction(fx.condominiumId, second.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID'); // CAL-005 guard

    // Reopen the LAST covering payer — now nothing approved remains → revert.
    await ctx.reconciliation.reopenTransaction(fx.condominiumId, first.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PENDING');
  });

  it('CAL-005: reopening an IGNORED stale-linked row does not revert a booking a real payment covers', async () => {
    // Phase 3: the single-reopen path now reverts only on an APPROVED→PENDING
    // edge. An IGNORED row carrying a stale link, when reopened, must not flip a
    // booking that a separate APPROVED transaction genuinely paid.
    const booking = await seedBooking(ctx, fx);
    const realPayer = await ctx.prisma.transaction.create({
      data: {
        condominiumId: fx.condominiumId,
        importBatchId: fx.batchId,
        transactionDate: TX_DATE,
        description: MATCHING_DESCRIPTION,
        credits: RENTAL_AMOUNT,
        balance: RENTAL_AMOUNT,
        flowType: FlowType.INCOME,
        matchedCalendarEventId: booking.id,
        matchSource: 'AUTO_TERRACE_BOOKING',
      },
      select: { id: true },
    });
    const ignoredStale = await ctx.prisma.transaction.create({
      data: {
        condominiumId: fx.condominiumId,
        importBatchId: fx.batchId,
        transactionDate: TX_DATE,
        description: MATCHING_DESCRIPTION,
        credits: RENTAL_AMOUNT,
        balance: 2 * RENTAL_AMOUNT,
        flowType: FlowType.INCOME,
        matchedCalendarEventId: booking.id,
        matchSource: 'AUTO_TERRACE_BOOKING',
        reconciliationStatus: 'IGNORED',
      },
      select: { id: true },
    });

    await ctx.reconciliation.approveTransaction(fx.condominiumId, realPayer.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID');

    // Reopen the IGNORED row: prior status was not APPROVED → no revert attempt,
    // and even if attempted the other-payer guard would keep it PAID.
    await ctx.reconciliation.reopenTransaction(fx.condominiumId, ignoredStale.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PAID');
  });

  it('CAL-012: a deposit-amount transaction is flagged TERRACE_DEPOSIT and never linked as rental', async () => {
    // Phase 3: the matcher now recognizes the security-deposit amount as a
    // distinct kind. A deposit-sized INCOME row with terrace signals lands in
    // review (TERRACE_DEPOSIT) instead of being ignored or mis-linked as rental.
    await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: DEPOSIT_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(tx.matchedCalendarEventId).toBeNull();
    expect(tx.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(tx.classificationStatus).toBe('NEEDS_REVIEW');
    expect(tx.requiresReviewReason).toBe('TERRACE_DEPOSIT');
  });

  it('CAL-012: when rental == deposit, a matching payment is forced to TERRACE_DEPOSIT review (no auto-PAID)', async () => {
    // The amount alone cannot tell rental from deposit, so it must not AUTO-link
    // and silently mark the booking PAID while rent may still be outstanding.
    await seedBooking(ctx, fx, {
      metadata: terraceMetadata({ securityDepositAmount: RENTAL_AMOUNT }),
    });
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);

    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(tx.matchedCalendarEventId).toBeNull();
    expect(tx.classificationStatus).toBe('NEEDS_REVIEW');
    expect(tx.requiresReviewReason).toBe('TERRACE_DEPOSIT');
  });

  it('CAL-004: a row manually reclassified away from terrace no longer marks the booking PAID on approval', async () => {
    // Phase 3: manualClassify clears matchedCalendarEventId, and approval is also
    // guarded on matchSource — so a row reclassified to a plain unit payment can
    // no longer resurrect the terrace booking's PAID state.
    const booking = await seedBooking(ctx, fx);
    await seedIncomeTransactions(ctx, fx, [
      { description: MATCHING_DESCRIPTION, credits: RENTAL_AMOUNT },
    ]);
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const tx = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, importBatchId: fx.batchId },
    });
    expect(tx.matchedCalendarEventId).toBe(booking.id); // linked by the engine

    // Operator reclassifies it to unit 101 as an ordinary payment.
    await ctx.classification.manualClassify(
      fx.condominiumId,
      tx.id,
      { unitNumber: '101', paymentConcept: 'MAINTENANCE' },
      fx.userId,
    );
    const reclassified = await ctx.prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    expect(reclassified.matchedCalendarEventId).toBeNull();

    // Approving it must NOT mark the booking PAID — the link is gone.
    await ctx.reconciliation.approveTransaction(fx.condominiumId, tx.id, fx.userId);
    expect(await readPaymentStatus(ctx, booking.id)).toBe('PENDING');
  });
});
