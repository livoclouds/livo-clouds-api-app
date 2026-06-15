/**
 * Calendar background-job integration test (CAL-068 — cron + reclassify safety net).
 *
 * The cron sweep and the CALENDAR_TERRACE_CHANGED → reclassify event flow are the
 * exact seams v2/v3 hardened (conditional updateMany/deleteMany where-clauses, the
 * FK-safe audit attribution, the day-normalized batch window). Their unit specs run
 * against mocked Prisma; this drives them against a REAL Postgres + a real
 * EventEmitter so the where-clauses, the audit rows, and the emitted event are
 * proven end-to-end — not just asserted on a mock call.
 *
 * Same harness contract as the other integration specs: `describeIntegration`
 * self-skips when no TEST_DATABASE_URL is configured. NEVER point this at a real
 * tenant database — `resetDb()` TRUNCATEs.
 */
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EventStatus,
  EventType,
  FlowType,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { BatchClassificationService } from '../../src/modules/classification/batch-classification.service';
import { ClassificationService } from '../../src/modules/classification/classification.service';
import { ManualClassificationService } from '../../src/modules/classification/manual-classification.service';
import { ReconciliationRulesService } from '../../src/modules/reconciliation-rules/reconciliation-rules.service';
import { ReconciliationLifecycleService } from '../../src/modules/reconciliation/reconciliation-lifecycle.service';
import { SummaryRecomputeService } from '../../src/modules/reconciliation/summary-recompute.service';
import { TerracePaymentLinkService } from '../../src/modules/reconciliation/terrace-payment-link.service';
import { SettingsCacheService } from '../../src/modules/settings/settings-cache.service';
import { CalendarMaintenanceCron } from '../../src/modules/calendar/calendar-maintenance.cron';
import { CalendarReclassifyService } from '../../src/modules/calendar/reclassify/calendar-reclassify.service';
import {
  CALENDAR_TERRACE_CHANGED,
  type CalendarTerraceChangedPayload,
} from '../../src/modules/calendar/events/calendar-terrace-changed.event';
import { SOFT_DELETE_RETENTION_MS } from '../../src/modules/calendar/calendar.constants';
import { describeIntegration, resetDb } from './db';

interface MaintenanceContext {
  moduleRef: TestingModule;
  prisma: PrismaService;
  cron: CalendarMaintenanceCron;
  reclassify: CalendarReclassifyService;
  emitter: EventEmitter2;
}

/** Boots the cron + reclassify + their classification dependency chain on real PG. */
async function createMaintenanceContext(): Promise<MaintenanceContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      EventEmitterModule.forRoot(),
    ],
    providers: [
      PrismaService,
      AuditService,
      SettingsCacheService,
      ReconciliationRulesService,
      SummaryRecomputeService,
      TerracePaymentLinkService,
      ReconciliationLifecycleService,
      BatchClassificationService,
      ManualClassificationService,
      ClassificationService,
      CalendarMaintenanceCron,
      CalendarReclassifyService,
    ],
  }).compile();

  await moduleRef.init();

  return {
    moduleRef,
    prisma: moduleRef.get(PrismaService),
    cron: moduleRef.get(CalendarMaintenanceCron),
    reclassify: moduleRef.get(CalendarReclassifyService),
    emitter: moduleRef.get(EventEmitter2),
  };
}

interface SeededTenant {
  condominiumId: string;
  userId: string;
}

async function seedTenant(prisma: PrismaService, slug: string): Promise<SeededTenant> {
  const condo = await prisma.condominium.create({
    data: { slug, name: `Maintenance IT ${slug}` },
  });
  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 100 },
  });
  const user = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `actor-${condo.id}@example.test`,
      passwordHash: 'x',
      firstName: 'Maint',
      lastName: 'Actor',
    },
  });
  return { condominiumId: condo.id, userId: user.id };
}

function terraceMetadata(overrides: Record<string, unknown> = {}): Prisma.InputJsonValue {
  return {
    terraceRentalAmount: 1500,
    securityDepositAmount: 1000,
    paymentStatus: 'PENDING',
    securityDepositStatus: 'PENDING',
    contractSigned: false,
    guestParkingRequested: false,
    setupNotes: '',
    customKeywords: [],
    ...overrides,
  } as Prisma.InputJsonValue;
}

const NOW = new Date('2026-06-15T05:00:00.000Z');
/** Comfortably past the 90-day retention window. */
const LONG_AGO = new Date(NOW.getTime() - SOFT_DELETE_RETENTION_MS - 5 * 24 * 60 * 60 * 1000);

describeIntegration('calendar maintenance + reclassify (integration)', () => {
  let ctx: MaintenanceContext;
  let tenant: SeededTenant;

  beforeAll(async () => {
    ctx = await createMaintenanceContext();
  });

  afterAll(async () => {
    if (ctx) await ctx.moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    tenant = await seedTenant(ctx.prisma, `maint-${Date.now()}`);
  });

  // ── Pass 1: stale PENDING expiry ─────────────────────────────────────────────

  it('cancels a past-start PENDING terrace booking, audits the system action, and emits a re-match', async () => {
    const booking = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Stale terrace',
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.PENDING,
        startDate: new Date('2026-06-10T18:00:00.000Z'), // before NOW
        endDate: new Date('2026-06-10T22:00:00.000Z'),
        metadata: terraceMetadata(),
      },
    });

    // Record-only emit spy: prevents the @OnEvent listener from firing an async
    // reclassify run (tested directly below) so this assertion stays deterministic.
    const emitSpy = jest.spyOn(ctx.emitter, 'emit').mockReturnValue(true);

    const result = await ctx.cron.sweep(NOW);

    expect(result.pendingExpired).toBe(1);

    // Real transition landed in Postgres.
    const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe(EventStatus.CANCELLED);

    // A real audit row attributes the system action to the event's creator.
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: booking.id, action: 'CALENDAR_EVENT_EXPIRED' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(tenant.userId);
    expect((audit!.afterState as { triggeredBy?: string }).triggeredBy).toBe(
      'system-calendar-maintenance',
    );

    // A CALENDAR_TERRACE_CHANGED re-match was emitted for the cancelled booking.
    const emitted = emitSpy.mock.calls.find((c) => c[0] === CALENDAR_TERRACE_CHANGED);
    expect(emitted).toBeDefined();
    const payload = emitted![1] as CalendarTerraceChangedPayload;
    expect(payload.condominiumId).toBe(tenant.condominiumId);
    expect(payload.triggeringEventId).toBe(booking.id);
    expect(payload.action).toBe('update');

    emitSpy.mockRestore();
  });

  it('auto-releases a FUTURE PENDING booking held unpaid past the tenant hold window (CAL-064)', async () => {
    // Tenant opts in to a 48-hour hold window.
    await ctx.prisma.condominiumSettings.update({
      where: { condominiumId: tenant.condominiumId },
      data: { pendingHoldWindowHours: 48 },
    });
    // A future-dated slot (startDate after NOW) created 72h ago and never paid —
    // the past-date branch would never touch it; only the hold window releases it.
    const booking = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Future unpaid terrace',
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.PENDING,
        createdAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000), // 72h ago > 48h
        startDate: new Date('2026-07-05T18:00:00.000Z'), // after NOW
        endDate: new Date('2026-07-05T22:00:00.000Z'),
        metadata: terraceMetadata(),
      },
    });
    const emitSpy = jest.spyOn(ctx.emitter, 'emit').mockReturnValue(true);

    const result = await ctx.cron.sweep(NOW);

    expect(result.pendingExpired).toBe(1);
    const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe(EventStatus.CANCELLED);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: booking.id, action: 'CALENDAR_EVENT_EXPIRED' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.afterState as { reason?: string }).reason).toBe('hold-window-exceeded');
    emitSpy.mockRestore();
  });

  it('keeps a FUTURE PENDING booking when the tenant hold window is disabled (default 0)', async () => {
    // Settings row created by seedTenant defaults pendingHoldWindowHours = 0.
    const booking = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Future unpaid terrace, window off',
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.PENDING,
        createdAt: new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000), // a year ago
        startDate: new Date('2026-07-05T18:00:00.000Z'), // after NOW
        endDate: new Date('2026-07-05T22:00:00.000Z'),
        metadata: terraceMetadata(),
      },
    });

    const result = await ctx.cron.sweep(NOW);

    expect(result.pendingExpired).toBe(0);
    const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe(EventStatus.PENDING);
  });

  // ── Pass 2: soft-delete retention purge ──────────────────────────────────────

  it('hard-deletes a childless event soft-deleted past the retention window and audits it', async () => {
    const old = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Old soft-deleted',
        eventType: EventType.GENERAL,
        status: EventStatus.CONFIRMED,
        startDate: new Date('2026-01-01T10:00:00.000Z'),
        endDate: new Date('2026-01-01T11:00:00.000Z'),
        deletedAt: LONG_AGO,
      },
    });

    const result = await ctx.cron.sweep(NOW);

    expect(result.softDeletedPurged).toBe(1);
    const gone = await ctx.prisma.calendarEvent.findUnique({ where: { id: old.id } });
    expect(gone).toBeNull();

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: old.id, action: 'CALENDAR_EVENT_PURGED' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.afterState as { triggeredBy?: string }).triggeredBy).toBe(
      'system-calendar-maintenance',
    );
  });

  it('does NOT purge a soft-deleted parent that still has a LIVE child (CAL-071)', async () => {
    const parent = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Soft-deleted parent',
        eventType: EventType.GENERAL,
        status: EventStatus.CONFIRMED,
        startDate: new Date('2026-01-01T10:00:00.000Z'),
        endDate: new Date('2026-01-01T11:00:00.000Z'),
        deletedAt: LONG_AGO,
      },
    });
    // A live (non-soft-deleted) child must pin the parent for another cycle.
    await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Live child',
        eventType: EventType.GENERAL,
        status: EventStatus.CONFIRMED,
        startDate: new Date('2026-01-02T10:00:00.000Z'),
        endDate: new Date('2026-01-02T11:00:00.000Z'),
        parentEventId: parent.id,
      },
    });

    const result = await ctx.cron.sweep(NOW);

    expect(result.softDeletedPurged).toBe(0);
    const stillThere = await ctx.prisma.calendarEvent.findUnique({ where: { id: parent.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.deletedAt).not.toBeNull();
  });

  // ── Reclassify event flow ────────────────────────────────────────────────────

  it('reclassify.run() re-matches affected INCOME batches in the window and writes a system audit trail', async () => {
    // A live terrace booking is the change that triggers the re-match.
    const booking = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Live terrace',
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.CONFIRMED,
        startDate: new Date('2026-06-20T18:00:00.000Z'),
        endDate: new Date('2026-06-20T22:00:00.000Z'),
        metadata: terraceMetadata(),
      },
    });

    // A PENDING, non-manual-override INCOME transaction in the trigger window is
    // exactly the row findAffectedBatches must surface (CAL-072).
    const bankProfile = await ctx.prisma.bankProfile.create({
      data: { condominiumId: tenant.condominiumId, name: `Generic-${Date.now()}`, excelAliases: {} },
    });
    const batch = await ctx.prisma.importBatch.create({
      data: {
        condominiumId: tenant.condominiumId,
        importedById: tenant.userId,
        bankProfileId: bankProfile.id,
        fileName: 'estado.xlsx',
        fileType: 'xlsx',
        fileSizeBytes: 1024,
        fileHash: `hash-${booking.id}`,
      },
    });
    await ctx.prisma.transaction.create({
      data: {
        condominiumId: tenant.condominiumId,
        importBatchId: batch.id,
        transactionDate: new Date('2026-06-12T00:00:00.000Z'),
        description: 'PAGO RESERVA TERRAZA',
        credits: 1500,
        balance: 1500,
        flowType: FlowType.INCOME,
        reconciliationStatus: 'PENDING',
      },
    });

    const payload: CalendarTerraceChangedPayload = {
      condominiumId: tenant.condominiumId,
      triggeringEventId: booking.id,
      reason: 'update:metadata',
      action: 'update',
      actorUserId: tenant.userId,
      windowStart: new Date('2026-05-21T00:00:00.000Z'),
      windowEnd: new Date('2026-06-20T23:59:59.999Z'),
    };

    // Drive the flow directly (deterministic — the @OnEvent path defers via
    // setImmediate). findAffectedBatches → reclassifyBatch → audit trail.
    await expect(ctx.reclassify.run(payload)).resolves.toBeUndefined();

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: booking.id, action: 'CALENDAR_AUTO_RECLASSIFY' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(tenant.userId);
    const after = audit!.afterState as {
      triggeredBy?: string;
      succeeded?: number;
      failed?: number;
    };
    expect(after.triggeredBy).toBe('system-reclassify');
    // Exactly one batch was in the window and got processed (succeeded or failed).
    expect((after.succeeded ?? 0) + (after.failed ?? 0)).toBe(1);
  });

  it('reclassify.run() with no batches in the window is a no-op and writes no audit row', async () => {
    const booking = await ctx.prisma.calendarEvent.create({
      data: {
        condominiumId: tenant.condominiumId,
        createdById: tenant.userId,
        title: 'Live terrace, no payments',
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.CONFIRMED,
        startDate: new Date('2026-06-20T18:00:00.000Z'),
        endDate: new Date('2026-06-20T22:00:00.000Z'),
        metadata: terraceMetadata(),
      },
    });

    const payload: CalendarTerraceChangedPayload = {
      condominiumId: tenant.condominiumId,
      triggeringEventId: booking.id,
      reason: 'create',
      action: 'create',
      actorUserId: tenant.userId,
      windowStart: new Date('2026-05-21T00:00:00.000Z'),
      windowEnd: new Date('2026-06-20T23:59:59.999Z'),
    };

    await ctx.reclassify.run(payload);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: booking.id, action: 'CALENDAR_AUTO_RECLASSIFY' },
    });
    expect(audit).toBeNull();
  });
});
