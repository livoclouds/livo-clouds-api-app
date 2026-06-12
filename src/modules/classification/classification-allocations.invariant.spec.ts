/**
 * ENGINE-006 — allocation-lifecycle invariant (property test).
 *
 * For ANY sequence of resident-linkage edits (split → unmatch → rematch →
 * single-unit reclassify → batch reclassify), the PaymentAllocation rows of a
 * transaction must always satisfy:
 *
 *     Σ allocatedAmount ∈ { 0, transaction.credits }   — exactly, in cents.
 *
 * Before Phase 3, only the split path cleaned up after itself; every other
 * linkage rewrite left stale allocations behind, silently corrupting resident
 * balances (collection.service partitions paid totals by "has allocations").
 *
 * The test drives the real ClassificationService against a stateful in-memory
 * PaymentAllocation store layered on the standard prisma-mock pattern.
 */
import { ClassificationStatus } from '@prisma/client';
import { ClassificationService } from './classification.service';
import { ReconciliationLifecycleService } from '../reconciliation/reconciliation-lifecycle.service';
import { SummaryRecomputeService } from '../reconciliation/summary-recompute.service';
import { TerracePaymentLinkService } from '../reconciliation/terrace-payment-link.service';
import { toCents } from '../../common/utils/money.util';

const CONDOMINIUM_ID = 'cond-1';
const BATCH_ID = 'batch-1';
const TX_ID = 'tx-prop-1';
const CREDITS = 1000;
const UNITS = ['1', '2', '3', '4', '5'];

interface AllocationRow {
  transactionId: string;
  condominiumId: string;
  residentId: string;
  unitNumber: string;
  allocatedAmount: number;
}

interface Store {
  allocations: AllocationRow[];
  tx: {
    id: string;
    residentId: string | null;
    updatedAt: Date;
  };
}

/** Deterministic LCG so failures reproduce. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeStatefulPrisma(store: Store) {
  const matchesTx = (where: Record<string, unknown>): boolean => {
    if (where.transactionId === TX_ID) return true;
    const nested = where.transaction as { importBatchId?: string } | undefined;
    return nested?.importBatchId === BATCH_ID;
  };

  const mock: Record<string, unknown> = {
    transaction: {
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: TX_ID,
          updatedAt: store.tx.updatedAt,
          description: 'PAGO MULTIUNIDAD',
          credits: CREDITS,
          residentId: store.tx.residentId,
          unitNumberDetected: null,
          unitNumbersDetected: [],
          paymentConcept: null,
          expenseCategoryId: null,
          supplierId: null,
          paymentPeriodMonth: 11,
          paymentPeriodYear: 2025,
          transactionDate: new Date('2025-11-15T00:00:00Z'),
          matchSource: null,
          classificationStatus: ClassificationStatus.NEEDS_REVIEW,
          requiresReviewReason: null,
          matchedRuleId: null,
          paymentAllocations: store.allocations
            .filter((a) => a.transactionId === TX_ID)
            .map((a) => ({
              residentId: a.residentId,
              unitNumber: a.unitNumber,
              allocatedAmount: a.allocatedAmount,
            })),
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if ('residentId' in data) {
          store.tx.residentId = data.residentId as string | null;
        }
        return Promise.resolve({ count: 1 });
      }),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { credits: null, charges: null }, _count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    resident: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve({ id: where.id ?? 'res-by-unit' }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    condominiumSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ terraceGlobalKeywords: [], totalUnits: 10 }),
    },
    financialMonthlySummary: { upsert: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn().mockResolvedValue(null) },
    reconciliationCorrectionPattern: {
      upsert: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    paymentAllocation: {
      deleteMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        const before = store.allocations.length;
        // Every stored row belongs to TX_ID/BATCH_ID in this harness, so a
        // matching where-clause clears the store wholesale.
        if (matchesTx(where)) store.allocations = [];
        return Promise.resolve({ count: before - store.allocations.length });
      }),
      createMany: jest.fn().mockImplementation(({ data }: { data: AllocationRow[] }) => {
        for (const row of data) {
          store.allocations.push({ ...row, allocatedAmount: Number(row.allocatedAmount) });
        }
        return Promise.resolve({ count: data.length });
      }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { allocatedAmount: null } }),
    },
    importBatch: {
      update: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ bankProfile: null }),
      findFirst: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    },
    $transaction: jest.fn(),
  };
  (mock.$transaction as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => Promise<unknown>)(mock);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return undefined;
  });
  // $executeRaw for the advisory-lock recompute path (ENGINE-022).
  (mock as { $executeRaw?: jest.Mock }).$executeRaw = jest.fn().mockResolvedValue(0);
  return mock;
}

function makeService(prisma: unknown): ClassificationService {
  const rulesService = { findActive: jest.fn().mockResolvedValue([]) };
  const events = { emit: jest.fn() };
  const settingsCache = {
    getSettings: jest
      .fn()
      .mockResolvedValue({ terraceGlobalKeywords: [], totalUnits: 10 }),
    invalidate: jest.fn(),
  };
  // ENGINE-008 decomposition: real collaborator instances over the same
  // prisma mock keep every write observable through the facade.
  const summaries = new SummaryRecomputeService(prisma as never);
  const terraceLinks = new TerracePaymentLinkService(prisma as never);
  const lifecycle = new ReconciliationLifecycleService(
    prisma as never,
    summaries,
    terraceLinks,
  );
  return new ClassificationService(
    prisma as never,
    rulesService as never,
    events as never,
    settingsCache as never,
    summaries,
    terraceLinks,
    lifecycle,
  );
}

function allocationSumCents(store: Store): number {
  return store.allocations
    .filter((a) => a.transactionId === TX_ID)
    .reduce((acc, a) => acc + toCents(a.allocatedAmount), 0);
}

/** Random exact split of CREDITS across 2..4 units (cent-precise). */
function randomSplit(rng: () => number) {
  const count = 2 + Math.floor(rng() * 3);
  const units = [...UNITS].sort(() => rng() - 0.5).slice(0, count);
  const totalCents = toCents(CREDITS);
  const amounts: number[] = [];
  let remaining = totalCents;
  for (let i = 0; i < count - 1; i++) {
    // Leave at least 1 cent for every remaining slice.
    const max = remaining - (count - 1 - i);
    const slice = 1 + Math.floor(rng() * Math.max(1, max - 1));
    amounts.push(slice);
    remaining -= slice;
  }
  amounts.push(remaining);
  return units.map((unitNumber, i) => ({
    unitNumber,
    residentId: `res-${unitNumber}`,
    allocatedAmount: amounts[i] / 100,
  }));
}

describe('PaymentAllocation lifecycle invariant (ENGINE-006)', () => {
  it('Σ allocations ∈ {0, credits} exactly, after every op of a 200-op random edit sequence', async () => {
    const store: Store = {
      allocations: [],
      tx: { id: TX_ID, residentId: null, updatedAt: new Date('2026-01-01T00:00:00Z') },
    };
    const prisma = makeStatefulPrisma(store);
    const service = makeService(prisma);

    const rng = makeRng(20260611);
    const history: string[] = [];

    for (let step = 0; step < 200; step++) {
      const op = Math.floor(rng() * 5);
      if (op === 0) {
        history.push('split');
        await service.manualClassify(
          CONDOMINIUM_ID,
          TX_ID,
          { allocations: randomSplit(rng) },
          'user-1',
        );
      } else if (op === 1) {
        history.push('manualMatch');
        await service.manualMatch(CONDOMINIUM_ID, TX_ID, 'res-1', 'user-1');
      } else if (op === 2) {
        history.push('unmatch');
        await service.unmatch(CONDOMINIUM_ID, TX_ID, 'user-1');
      } else if (op === 3) {
        history.push('manualClassify(unit)');
        await service.manualClassify(
          CONDOMINIUM_ID,
          TX_ID,
          { unitNumber: UNITS[Math.floor(rng() * UNITS.length)] },
          'user-1',
        );
      } else {
        history.push('reclassifyBatch');
        await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID, 'user-1');
      }

      const sumCents = allocationSumCents(store);
      const valid = sumCents === 0 || sumCents === toCents(CREDITS);
      if (!valid) {
        throw new Error(
          `Invariant broken after step ${step} (${history.slice(-5).join(' → ')}): ` +
            `Σ allocations = ${sumCents} cents, expected 0 or ${toCents(CREDITS)}`,
        );
      }
      // A linkage rewrite to a single resident must leave ZERO allocations.
      if (op === 1 || op === 2 || op === 3 || op === 4) {
        expect(sumCents).toBe(0);
      }
    }
  });

  it('concept-only manualClassify preserves an existing split', async () => {
    const store: Store = {
      allocations: [],
      tx: { id: TX_ID, residentId: null, updatedAt: new Date('2026-01-01T00:00:00Z') },
    };
    const prisma = makeStatefulPrisma(store);
    const service = makeService(prisma);

    await service.manualClassify(
      CONDOMINIUM_ID,
      TX_ID,
      {
        allocations: [
          { unitNumber: '1', residentId: 'res-1', allocatedAmount: 600 },
          { unitNumber: '2', residentId: 'res-2', allocatedAmount: 400 },
        ],
      },
      'user-1',
    );
    expect(allocationSumCents(store)).toBe(toCents(CREDITS));

    // Edit only the concept — unitNumber stays undefined → the split survives.
    await service.manualClassify(
      CONDOMINIUM_ID,
      TX_ID,
      { paymentConcept: 'MAINTENANCE' },
      'user-1',
    );
    expect(allocationSumCents(store)).toBe(toCents(CREDITS));
    expect(store.allocations).toHaveLength(2);
  });

  it('a STALE_OVERRIDE conflict leaves existing allocations untouched', async () => {
    const store: Store = {
      allocations: [
        {
          transactionId: TX_ID,
          condominiumId: CONDOMINIUM_ID,
          residentId: 'res-1',
          unitNumber: '1',
          allocatedAmount: CREDITS,
        },
      ],
      tx: { id: TX_ID, residentId: null, updatedAt: new Date('2026-01-01T00:00:00Z') },
    };
    const prisma = makeStatefulPrisma(store);
    (
      (prisma as { transaction: { updateMany: jest.Mock } }).transaction.updateMany
    ).mockResolvedValue({ count: 0 }); // concurrent edit detected
    const service = makeService(prisma);

    await expect(
      service.manualMatch(CONDOMINIUM_ID, TX_ID, 'res-2', 'user-1'),
    ).rejects.toMatchObject({ response: { code: 'STALE_OVERRIDE' } });
    expect(store.allocations).toHaveLength(1);
  });
});
