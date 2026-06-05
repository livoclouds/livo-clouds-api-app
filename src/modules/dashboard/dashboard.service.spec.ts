import { DashboardService } from './dashboard.service';

const CONDOMINIUM_ID = 'cond-1';
const YEAR = 2026;

interface PrismaMock {
  financialMonthlySummary: { findMany: jest.Mock };
  resident: { count: jest.Mock };
  $queryRaw: jest.Mock;
}

/**
 * `getMonthlyTrend` issues two tagged-template `$queryRaw` calls:
 *  - the paid-count query against `collection_records` (always)
 *  - the fallback aggregation against `transactions` (only when there are no
 *    FinancialMonthlySummary rows for the year)
 * Both land on the same `$queryRaw` mock, so we route by the SQL text.
 */
function sqlText(strings: TemplateStringsArray): string {
  return strings.join(' ');
}

function makePrismaMock(
  options: {
    summaries?: Array<Record<string, unknown>>;
    totalResidents?: number;
    paidCountRows?: Array<{ month: number; paidCount: number }>;
    trendRows?: Array<{ month: number; income: number; expenses: number }>;
  } = {},
): PrismaMock {
  const {
    summaries = [],
    totalResidents = 0,
    paidCountRows = [],
    trendRows = [],
  } = options;

  return {
    financialMonthlySummary: {
      findMany: jest.fn().mockResolvedValue(summaries),
    },
    resident: {
      count: jest.fn().mockResolvedValue(totalResidents),
    },
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = sqlText(strings);
      if (sql.includes('collection_records')) {
        return Promise.resolve(paidCountRows);
      }
      return Promise.resolve(trendRows);
    }),
  };
}

function makeService(prisma: PrismaMock): DashboardService {
  // settingsCache is unused by getMonthlyTrend.
  return new DashboardService(prisma as never, {} as never);
}

describe('DashboardService.getMonthlyTrend', () => {
  it('maps the 12-month trend from FinancialMonthlySummary when summaries exist (no fallback query)', async () => {
    const prisma = makePrismaMock({
      summaries: [
        { month: 1, totalIncome: 1000, totalExpenses: 400 },
        { month: 3, totalIncome: 500, totalExpenses: 250 },
      ],
      totalResidents: 10,
      paidCountRows: [
        { month: 1, paidCount: 5 },
        { month: 3, paidCount: 2 },
      ],
    });
    const service = makeService(prisma);

    const result = await service.getMonthlyTrend(CONDOMINIUM_ID, YEAR);

    expect(result).toHaveLength(12);
    expect(result[0]).toEqual({
      month: 1,
      income: 1000,
      expenses: 400,
      collectionRate: 50, // 5 / 10
    });
    expect(result[2]).toEqual({
      month: 3,
      income: 500,
      expenses: 250,
      collectionRate: 20, // 2 / 10
    });
    // Empty month falls back to zeros.
    expect(result[1]).toEqual({
      month: 2,
      income: 0,
      expenses: 0,
      collectionRate: 0,
    });

    // Only the paid-count query ran — the transactions fallback must NOT fire.
    const ranTransactionsQuery = prisma.$queryRaw.mock.calls.some(
      ([strings]: [TemplateStringsArray]) =>
        sqlText(strings).includes('"transactions"'),
    );
    expect(ranTransactionsQuery).toBe(false);
  });

  it('falls back to the transactions aggregation query when there are no summaries', async () => {
    const prisma = makePrismaMock({
      summaries: [],
      totalResidents: 4,
      paidCountRows: [{ month: 6, paidCount: 1 }],
      trendRows: [{ month: 6, income: 1200, expenses: 300 }],
    });
    const service = makeService(prisma);

    const result = await service.getMonthlyTrend(CONDOMINIUM_ID, YEAR);

    expect(result).toHaveLength(12);
    expect(result[5]).toEqual({
      month: 6,
      income: 1200,
      expenses: 300,
      collectionRate: 25, // 1 / 4
    });
    // Months without rows default to zeros.
    expect(result[0]).toEqual({
      month: 1,
      income: 0,
      expenses: 0,
      collectionRate: 0,
    });
  });

  it('emits the fallback SQL with quoted camelCase identifiers (regression: column "transaction_date" 42703)', async () => {
    const prisma = makePrismaMock({ summaries: [], trendRows: [] });
    const service = makeService(prisma);

    await service.getMonthlyTrend(CONDOMINIUM_ID, YEAR);

    const fallbackCall = prisma.$queryRaw.mock.calls.find(
      ([strings]: [TemplateStringsArray]) =>
        sqlText(strings).includes('"transactions"'),
    );
    expect(fallbackCall).toBeDefined();

    const sql = sqlText(fallbackCall![0] as TemplateStringsArray);
    // Correct quoted camelCase identifiers must be present...
    expect(sql).toContain('"transactionDate"');
    expect(sql).toContain('"flowType"');
    expect(sql).toContain('"condominiumId"');
    expect(sql).toContain('"transactions"');
    // ...and the broken unquoted snake_case identifiers must be gone.
    expect(sql).not.toContain('transaction_date');
    expect(sql).not.toContain('flow_type');
    expect(sql).not.toContain('condominium_id');
  });
});
