import { NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

const CONDOMINIUM_ID = 'cond-1';
const OTHER_CONDOMINIUM_ID = 'cond-2';
const TRANSACTION_ID = 'tx-1';
const USER_ID = 'user-42';

interface PrismaMock {
  transaction: {
    findFirst: jest.Mock;
  };
  auditLog: {
    findMany: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    transaction: {
      findFirst: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeService(prisma: PrismaMock): TransactionsService {
  return new TransactionsService(prisma as never);
}

function baseAuditEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'audit-1',
    condominiumId: CONDOMINIUM_ID,
    userId: USER_ID,
    action: 'TRANSACTION_APPROVED',
    actionCategory: 'RECONCILIATION',
    module: 'TRANSACTIONS',
    entityType: 'Transaction',
    entityId: TRANSACTION_ID,
    beforeState: null,
    afterState: { reconciliationStatus: 'APPROVED' },
    ipAddress: null,
    userAgent: null,
    result: 'SUCCESS',
    description: null,
    detail: null,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    user: { id: USER_ID, firstName: 'Ana', lastName: 'García', email: 'ana@example.com' },
    ...overrides,
  };
}

describe('TransactionsService.getAuditChain', () => {
  it('returns audit rows in chronological order for a transaction with history', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValueOnce({ id: TRANSACTION_ID });

    const entry1 = baseAuditEntry({ id: 'audit-1', createdAt: new Date('2026-05-01T10:00:00Z') });
    const entry2 = baseAuditEntry({
      id: 'audit-2',
      action: 'TRANSACTION_REOPENED',
      createdAt: new Date('2026-05-02T10:00:00Z'),
    });
    const entry3 = baseAuditEntry({
      id: 'audit-3',
      action: 'TRANSACTION_APPROVED',
      createdAt: new Date('2026-05-03T10:00:00Z'),
    });
    prisma.auditLog.findMany.mockResolvedValueOnce([entry1, entry2, entry3]);

    const result = await service.getAuditChain(CONDOMINIUM_ID, TRANSACTION_ID);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(entry1);
    expect(result[1]).toBe(entry2);
    expect(result[2]).toBe(entry3);

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
      where: { id: TRANSACTION_ID, condominiumId: CONDOMINIUM_ID },
      select: { id: true },
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { entityId: TRANSACTION_ID },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('returns an empty array when a transaction exists but has no audit history', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValueOnce({ id: TRANSACTION_ID });
    prisma.auditLog.findMany.mockResolvedValueOnce([]);

    const result = await service.getAuditChain(CONDOMINIUM_ID, TRANSACTION_ID);

    expect(result).toEqual([]);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when the transaction does not exist', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    await expect(service.getAuditChain(CONDOMINIUM_ID, 'nonexistent-tx')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the transaction belongs to a different condominium', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    // findFirst returns null because condominiumId does not match
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    await expect(service.getAuditChain(OTHER_CONDOMINIUM_ID, TRANSACTION_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
      where: { id: TRANSACTION_ID, condominiumId: OTHER_CONDOMINIUM_ID },
      select: { id: true },
    });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
