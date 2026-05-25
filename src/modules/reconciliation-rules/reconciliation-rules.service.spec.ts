import { ConflictException } from '@nestjs/common';
import { Prisma, RuleChangeAction } from '@prisma/client';
import { ReconciliationRulesService } from './reconciliation-rules.service';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-42';

interface PrismaMock {
  reconciliationRule: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  reconciliationRuleChangeLog: {
    create: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
  };
  transaction: { count: jest.Mock };
  user: { findMany: jest.Mock };
  $transaction: jest.Mock;
}

interface EventsMock {
  emit: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock = {
    reconciliationRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { priority: null } }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    reconciliationRuleChangeLog: {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    transaction: { count: jest.fn().mockResolvedValue(0) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  } as Omit<PrismaMock, '$transaction'>;

  // For interactive transactions (callback form), invoke the callback with
  // the mock itself as the tx client.
  // For array-form transactions, resolve with the array of promises so
  // service code can await the result.
  const $transaction = jest.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(mock);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return Promise.resolve();
  });

  return Object.assign(mock, { $transaction });
}

function makeEventsMock(): EventsMock {
  return { emit: jest.fn() };
}

function makeService(prisma: PrismaMock, events: EventsMock): ReconciliationRulesService {
  return new ReconciliationRulesService(prisma as never, events as never);
}

function makeRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rule-1',
    condominiumId: CONDOMINIUM_ID,
    name: 'Rule 1',
    keywords: ['kw'],
    unitPatterns: [],
    conceptType: null,
    confidenceThreshold: new Prisma.Decimal('0.80'),
    isActive: true,
    priority: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ReconciliationRulesService', () => {
  let prisma: PrismaMock;
  let events: EventsMock;
  let service: ReconciliationRulesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    events = makeEventsMock();
    service = makeService(prisma, events);
  });

  describe('create', () => {
    it('appends to the end with priority MAX+1 when other rules exist', async () => {
      prisma.reconciliationRule.aggregate.mockResolvedValue({ _max: { priority: 3 } });
      prisma.reconciliationRule.create.mockResolvedValue(
        makeRule({ id: 'rule-new', priority: 4, name: 'New' }),
      );

      const result = await service.create(
        CONDOMINIUM_ID,
        { name: 'New', keywords: ['kw'] },
        USER_ID,
      );

      expect(prisma.reconciliationRule.aggregate).toHaveBeenCalledWith({
        where: { condominiumId: CONDOMINIUM_ID },
        _max: { priority: true },
      });
      expect(prisma.reconciliationRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 4 }),
        }),
      );
      expect(result.priority).toBe(4);
      expect(prisma.reconciliationRuleChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: RuleChangeAction.CREATED,
            ruleId: 'rule-new',
          }),
        }),
      );
    });

    it('starts at priority 1 for the first rule of a condominium', async () => {
      prisma.reconciliationRule.aggregate.mockResolvedValue({ _max: { priority: null } });
      prisma.reconciliationRule.create.mockResolvedValue(
        makeRule({ id: 'rule-1', priority: 1 }),
      );

      await service.create(
        CONDOMINIUM_ID,
        { name: 'First', keywords: ['kw'] },
        USER_ID,
      );

      expect(prisma.reconciliationRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 1 }),
        }),
      );
    });
  });

  describe('reorder', () => {
    it('rewrites priorities to 1..N in the requested order', async () => {
      prisma.reconciliationRule.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      prisma.reconciliationRule.update.mockImplementation((args) =>
        Promise.resolve(makeRule({ id: args.where.id, priority: args.data.priority })),
      );

      const updated = await service.reorder(
        CONDOMINIUM_ID,
        ['c', 'a', 'b'],
        USER_ID,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'c' },
        data: { priority: 1 },
      });
      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'a' },
        data: { priority: 2 },
      });
      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { priority: 3 },
      });
      expect(updated.map((r) => r.id)).toEqual(['c', 'a', 'b']);
      expect(prisma.reconciliationRuleChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: RuleChangeAction.REORDERED,
            ruleId: null,
          }),
        }),
      );
    });

    it('throws ConflictException when payload misses rules', async () => {
      prisma.reconciliationRule.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);

      await expect(
        service.reorder(CONDOMINIUM_ID, ['a', 'b'], USER_ID),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payload references a foreign rule', async () => {
      prisma.reconciliationRule.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await expect(
        service.reorder(CONDOMINIUM_ID, ['a', 'foreign'], USER_ID),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes and resequences remaining rules to 1..N', async () => {
      prisma.reconciliationRule.findFirst.mockResolvedValue(
        makeRule({ id: 'rule-target', priority: 2, name: 'Target' }),
      );
      prisma.reconciliationRule.findMany.mockResolvedValue([
        { id: 'rule-a' },
        { id: 'rule-c' },
      ]);
      prisma.reconciliationRule.update.mockImplementation((args) =>
        Promise.resolve(makeRule({ id: args.where.id, priority: args.data.priority })),
      );

      await service.remove(CONDOMINIUM_ID, 'rule-target', USER_ID);

      expect(prisma.reconciliationRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-target' },
      });
      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-a' },
        data: { priority: 1 },
      });
      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-c' },
        data: { priority: 2 },
      });
      expect(prisma.reconciliationRuleChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: RuleChangeAction.DELETED,
            ruleId: null,
            ruleName: 'Target',
          }),
        }),
      );
    });
  });
});
