import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, RuleChangeAction } from '@prisma/client';
import { ReconciliationRulesService } from './reconciliation-rules.service';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-42';

interface PrismaMock {
  reconciliationRule: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  reconciliationRuleChangeLog: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
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
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { priority: null } }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    reconciliationRuleChangeLog: {
      create: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
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
    ruleKind: 'CONCEPT',
    keywords: ['kw'],
    unitPatterns: [],
    conceptType: null,
    assignedUnitNumber: null,
    unitExtractionPattern: null,
    unitExtractionGroup: 1,
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

    it('persists ruleKind + unit outcome fields for a UNIT rule', async () => {
      prisma.reconciliationRule.aggregate.mockResolvedValue({ _max: { priority: null } });
      prisma.reconciliationRule.create.mockResolvedValue(
        makeRule({
          id: 'rule-u',
          ruleKind: 'UNIT',
          conceptType: null,
          assignedUnitNumber: null,
          unitExtractionPattern: 'apt-(\\d+)',
          unitExtractionGroup: 1,
        }),
      );

      await service.create(
        CONDOMINIUM_ID,
        {
          name: 'APT format',
          keywords: ['kw'],
          ruleKind: 'UNIT' as never,
          unitExtractionPattern: 'apt-(\\d+)',
          unitExtractionGroup: 1,
        },
        USER_ID,
      );

      expect(prisma.reconciliationRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ruleKind: 'UNIT',
            unitExtractionPattern: 'apt-(\\d+)',
            unitExtractionGroup: 1,
            assignedUnitNumber: null,
          }),
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

  describe('discardSingleChange', () => {
    function makeSnapshot(overrides: Record<string, unknown> = {}) {
      return {
        id: 'rule-1',
        condominiumId: CONDOMINIUM_ID,
        name: 'Original name',
        keywords: ['kw'],
        unitPatterns: [],
        conceptType: null,
        confidenceThreshold: '0.80',
        isActive: true,
        priority: 1,
        ...overrides,
      };
    }

    it('throws NotFoundException when entry does not exist or is already applied', async () => {
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue(null);
      await expect(
        service.discardSingleChange(CONDOMINIUM_ID, 'missing', USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for REORDERED action', async () => {
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-1',
        condominiumId: CONDOMINIUM_ID,
        ruleId: null,
        action: RuleChangeAction.REORDERED,
        changedAt: new Date(),
        previousState: null,
        newState: null,
      });
      await expect(
        service.discardSingleChange(CONDOMINIUM_ID, 'change-1', USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when snapshot missing for non-CREATED entry', async () => {
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-1',
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-1',
        action: RuleChangeAction.UPDATED,
        changedAt: new Date(),
        previousState: null,
        newState: null,
      });
      await expect(
        service.discardSingleChange(CONDOMINIUM_ID, 'change-1', USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('CREATED → deletes the rule and removes cascade entries', async () => {
      const changedAt = new Date('2026-05-25T10:00:00Z');
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-created',
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-new',
        action: RuleChangeAction.CREATED,
        changedAt,
        previousState: null,
        newState: makeSnapshot({ id: 'rule-new' }),
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-created', action: RuleChangeAction.CREATED },
        { id: 'change-toggle-after', action: RuleChangeAction.TOGGLED },
      ]);

      const result = await service.discardSingleChange(
        CONDOMINIUM_ID,
        'change-created',
        USER_ID,
      );

      expect(prisma.reconciliationRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-new' },
      });
      expect(prisma.reconciliationRuleChangeLog.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['change-created', 'change-toggle-after'] } },
      });
      expect(result.updatedRule).toBeNull();
    });

    it('UPDATED → applies previousState fields back to the rule', async () => {
      const changedAt = new Date('2026-05-25T10:00:00Z');
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-update',
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-1',
        action: RuleChangeAction.UPDATED,
        changedAt,
        previousState: makeSnapshot({
          name: 'Old name',
          keywords: ['old'],
          confidenceThreshold: '0.75',
        }),
        newState: makeSnapshot({ name: 'New name', keywords: ['new'] }),
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-update', action: RuleChangeAction.UPDATED },
      ]);
      prisma.reconciliationRule.update.mockResolvedValue(
        makeRule({ id: 'rule-1', name: 'Old name', keywords: ['old'] }),
      );

      const result = await service.discardSingleChange(
        CONDOMINIUM_ID,
        'change-update',
        USER_ID,
      );

      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: expect.objectContaining({
          name: 'Old name',
          keywords: ['old'],
          isActive: true,
        }),
      });
      const updateCall = prisma.reconciliationRule.update.mock.calls[0][0] as {
        data: { confidenceThreshold: Prisma.Decimal };
      };
      expect(updateCall.data.confidenceThreshold.toString()).toBe('0.75');
      expect(result.updatedRule).not.toBeNull();
      expect(events.emit).toHaveBeenCalled();
    });

    it('TOGGLED → restores isActive from previousState', async () => {
      const changedAt = new Date('2026-05-25T10:00:00Z');
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-toggle',
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-1',
        action: RuleChangeAction.TOGGLED,
        changedAt,
        previousState: makeSnapshot({ isActive: true }),
        newState: makeSnapshot({ isActive: false }),
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-toggle', action: RuleChangeAction.TOGGLED },
      ]);
      prisma.reconciliationRule.update.mockResolvedValue(
        makeRule({ id: 'rule-1', isActive: true }),
      );

      await service.discardSingleChange(CONDOMINIUM_ID, 'change-toggle', USER_ID);

      expect(prisma.reconciliationRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: expect.objectContaining({ isActive: true }),
      });
    });

    it('DELETED → restores the rule with the original UUID', async () => {
      const changedAt = new Date('2026-05-25T10:00:00Z');
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-deleted',
        condominiumId: CONDOMINIUM_ID,
        ruleId: null,
        action: RuleChangeAction.DELETED,
        changedAt,
        previousState: makeSnapshot({ id: 'rule-original-uuid', name: 'Gone but back' }),
        newState: null,
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-deleted', action: RuleChangeAction.DELETED },
      ]);
      prisma.reconciliationRule.findUnique.mockResolvedValue(null);
      prisma.reconciliationRule.create.mockResolvedValue(
        makeRule({ id: 'rule-original-uuid', name: 'Gone but back' }),
      );

      const result = await service.discardSingleChange(
        CONDOMINIUM_ID,
        'change-deleted',
        USER_ID,
      );

      expect(prisma.reconciliationRule.findUnique).toHaveBeenCalledWith({
        where: { id: 'rule-original-uuid' },
        select: { id: true },
      });
      expect(prisma.reconciliationRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'rule-original-uuid',
          name: 'Gone but back',
        }),
      });
      expect(result.updatedRule).not.toBeNull();
    });

    it('DELETED → restores a UNIT rule with its kind + extraction fields intact', async () => {
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-deleted-unit',
        condominiumId: CONDOMINIUM_ID,
        ruleId: null,
        action: RuleChangeAction.DELETED,
        changedAt: new Date('2026-05-25T10:00:00Z'),
        previousState: makeSnapshot({
          id: 'rule-unit-uuid',
          name: 'APT format',
          ruleKind: 'UNIT',
          assignedUnitNumber: null,
          unitExtractionPattern: 'apt-(\\d+)',
          unitExtractionGroup: 1,
        }),
        newState: null,
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-deleted-unit', action: RuleChangeAction.DELETED },
      ]);
      prisma.reconciliationRule.findUnique.mockResolvedValue(null);
      prisma.reconciliationRule.create.mockResolvedValue(
        makeRule({ id: 'rule-unit-uuid', ruleKind: 'UNIT' }),
      );

      await service.discardSingleChange(CONDOMINIUM_ID, 'change-deleted-unit', USER_ID);

      expect(prisma.reconciliationRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'rule-unit-uuid',
          ruleKind: 'UNIT',
          unitExtractionPattern: 'apt-(\\d+)',
          unitExtractionGroup: 1,
        }),
      });
    });

    it('DELETED → throws ConflictException when UUID is already taken', async () => {
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-deleted',
        condominiumId: CONDOMINIUM_ID,
        ruleId: null,
        action: RuleChangeAction.DELETED,
        changedAt: new Date(),
        previousState: makeSnapshot({ id: 'rule-x' }),
        newState: null,
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-deleted', action: RuleChangeAction.DELETED },
      ]);
      prisma.reconciliationRule.findUnique.mockResolvedValue({ id: 'rule-x' });

      await expect(
        service.discardSingleChange(CONDOMINIUM_ID, 'change-deleted', USER_ID),
      ).rejects.toThrow(ConflictException);
      expect(prisma.reconciliationRule.create).not.toHaveBeenCalled();
    });

    it('cascade-deletes every later unapplied entry for the same rule', async () => {
      const changedAt = new Date('2026-05-25T10:00:00Z');
      prisma.reconciliationRuleChangeLog.findFirst.mockResolvedValue({
        id: 'change-A',
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-1',
        action: RuleChangeAction.UPDATED,
        changedAt,
        previousState: makeSnapshot(),
        newState: makeSnapshot({ name: 'After A' }),
      });
      prisma.reconciliationRuleChangeLog.findMany.mockResolvedValueOnce([
        { id: 'change-A', action: RuleChangeAction.UPDATED },
        { id: 'change-B', action: RuleChangeAction.TOGGLED },
        { id: 'change-C', action: RuleChangeAction.UPDATED },
      ]);
      prisma.reconciliationRule.update.mockResolvedValue(makeRule());

      await service.discardSingleChange(CONDOMINIUM_ID, 'change-A', USER_ID);

      expect(prisma.reconciliationRuleChangeLog.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['change-A', 'change-B', 'change-C'] } },
      });
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
