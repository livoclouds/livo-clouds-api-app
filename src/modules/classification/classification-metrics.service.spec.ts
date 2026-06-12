import { ClassificationMetricsService } from './classification-metrics.service';

const CONDOMINIUM_ID = 'cond-1';

interface PrismaMock {
  $queryRaw: jest.Mock;
  transaction: { groupBy: jest.Mock };
  reconciliationRule: { findMany: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    transaction: {
      // Call order: by matchSource, by matchedRuleId, by matchedPatternLabel.
      groupBy: jest.fn().mockResolvedValue([]),
    },
    reconciliationRule: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeService(prisma: PrismaMock): ClassificationMetricsService {
  return new ClassificationMetricsService(prisma as never);
}

describe('ClassificationMetricsService.getPrecisionMetrics (ENGINE-058)', () => {
  it('combines audit overrides with surviving AUTO rows into per-matchSource rates', async () => {
    const prisma = makePrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      { match_source: 'RULE', rule_id: 'rule-1', overridden: 1 },
      { match_source: 'AUTO_UNIT_NUMBER', rule_id: null, overridden: 3 },
    ]);
    prisma.transaction.groupBy
      .mockResolvedValueOnce([
        { matchSource: 'RULE', _count: { _all: 3 } },
        { matchSource: 'AUTO_UNIT_NUMBER', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { matchedRuleId: 'rule-1', _count: { _all: 3 } },
      ]);

    const metrics = await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);

    expect(metrics.byMatchSource).toEqual([
      {
        matchSource: 'AUTO_UNIT_NUMBER',
        autoTotal: 4,
        stillAuto: 1,
        overridden: 3,
        overrideRate: 0.75,
      },
      {
        matchSource: 'RULE',
        autoTotal: 4,
        stillAuto: 3,
        overridden: 1,
        overrideRate: 0.25,
      },
    ]);
  });

  it('attributes per-rule overrides and joins the rule name (null when deleted)', async () => {
    const prisma = makePrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      { match_source: 'RULE', rule_id: 'rule-live', overridden: 1 },
      { match_source: 'RULE', rule_id: 'rule-deleted', overridden: 2 },
    ]);
    prisma.transaction.groupBy
      .mockResolvedValueOnce([{ matchSource: 'RULE', _count: { _all: 4 } }])
      .mockResolvedValueOnce([
        { matchedRuleId: 'rule-live', _count: { _all: 4 } },
      ]);
    prisma.reconciliationRule.findMany.mockResolvedValue([
      { id: 'rule-live', name: 'Mantenimiento' },
    ]);

    const metrics = await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);

    expect(metrics.byRule).toEqual([
      {
        ruleId: 'rule-deleted',
        ruleName: null,
        autoTotal: 2,
        stillAuto: 0,
        overridden: 2,
        overrideRate: 1,
      },
      {
        ruleId: 'rule-live',
        ruleName: 'Mantenimiento',
        autoTotal: 5,
        stillAuto: 4,
        overridden: 1,
        overrideRate: 0.2,
      },
    ]);
    expect(prisma.reconciliationRule.findMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['rule-live', 'rule-deleted']) }, condominiumId: CONDOMINIUM_ID },
      select: { id: true, name: true },
    });
  });

  it('returns rate 0 with autoTotal 0 instead of dividing by zero', async () => {
    const prisma = makePrismaMock();
    const metrics = await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);
    expect(metrics.byMatchSource).toEqual([]);
    expect(metrics.byRule).toEqual([]);
  });

  it('buckets corrections with no matchSource in beforeState under UNKNOWN', async () => {
    const prisma = makePrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      { match_source: null, rule_id: null, overridden: 2 },
    ]);
    const metrics = await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);
    expect(metrics.byMatchSource).toEqual([
      {
        matchSource: 'UNKNOWN',
        autoTotal: 2,
        stillAuto: 0,
        overridden: 2,
        overrideRate: 1,
      },
    ]);
  });

  it('defaults the range to all-time (null bounds in the response) when omitted', async () => {
    const prisma = makePrismaMock();
    const metrics = await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);
    expect(metrics.range).toEqual({ from: null, to: null });
  });

  it('echoes an explicit range back as ISO strings', async () => {
    const prisma = makePrismaMock();
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-06-01T00:00:00Z');
    const metrics = await makeService(prisma).getPrecisionMetrics(
      CONDOMINIUM_ID,
      { from, to },
    );
    expect(metrics.range).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    });
  });

  it('tenant-scopes every groupBy query to the condominium', async () => {
    const prisma = makePrismaMock();
    await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);
    expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { condominiumId: CONDOMINIUM_ID, classificationStatus: 'AUTO' },
      }),
    );
    expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          condominiumId: CONDOMINIUM_ID,
          classificationStatus: 'AUTO',
          matchedRuleId: { not: null },
        },
      }),
    );
    expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          condominiumId: CONDOMINIUM_ID,
          classificationStatus: 'AUTO',
          matchedPatternLabel: { not: null },
        },
      }),
    );
  });

  // ENGINE-042 (Phase 4): override rates sliced per extraction pattern.
  it('combines pattern-label audits with surviving AUTO rows into byPattern rates', async () => {
    const prisma = makePrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      { match_source: 'AUTO_UNIT_NUMBER', rule_id: null, pattern_label: 'casa', overridden: 1 },
      { match_source: 'AUTO_UNIT_NUMBER', rule_id: null, pattern_label: '#', overridden: 3 },
      // Pre-Phase-4 audit rows carry no label → excluded from byPattern.
      { match_source: 'AUTO_UNIT_NUMBER', rule_id: null, pattern_label: null, overridden: 5 },
    ]);
    prisma.transaction.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { matchedPatternLabel: 'casa', _count: { _all: 9 } },
        { matchedPatternLabel: 'banbajio:segment', _count: { _all: 4 } },
      ]);

    const metrics = await makeService(prisma).getPrecisionMetrics(CONDOMINIUM_ID);

    expect(metrics.byPattern).toEqual([
      { patternLabel: '#', autoTotal: 3, stillAuto: 0, overridden: 3, overrideRate: 1 },
      { patternLabel: 'banbajio:segment', autoTotal: 4, stillAuto: 4, overridden: 0, overrideRate: 0 },
      { patternLabel: 'casa', autoTotal: 10, stillAuto: 9, overridden: 1, overrideRate: 0.1 },
    ]);
  });
});
