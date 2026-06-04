import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExpenseCategoriesService } from './expense-categories.service';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-42';

interface PrismaMock {
  expenseCategory: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock = {
    expenseCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as Omit<PrismaMock, '$transaction'>;
  const $transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : Promise.resolve(),
  );
  return Object.assign(mock, { $transaction });
}

describe('ExpenseCategoriesService', () => {
  let prisma: PrismaMock;
  let service: ExpenseCategoriesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ExpenseCategoriesService(prisma as never);
  });

  describe('findAll', () => {
    it('lists only active categories by default', async () => {
      await service.findAll(CONDOMINIUM_ID);
      expect(prisma.expenseCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { condominiumId: CONDOMINIUM_ID, deletedAt: null, isActive: true },
        }),
      );
    });

    it('includes inactive when asked', async () => {
      await service.findAll(CONDOMINIUM_ID, { includeInactive: true });
      expect(prisma.expenseCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { condominiumId: CONDOMINIUM_ID, deletedAt: null },
        }),
      );
    });
  });

  describe('create', () => {
    it('appends after the current max sortOrder and trims the name', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValueOnce(null); // name-free check
      prisma.expenseCategory.findFirst.mockResolvedValueOnce({ sortOrder: 4 }); // last
      prisma.expenseCategory.create.mockResolvedValue({ id: 'new' });

      await service.create(CONDOMINIUM_ID, { name: '  Seguridad  ' }, USER_ID);

      expect(prisma.expenseCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            condominiumId: CONDOMINIUM_ID,
            name: 'Seguridad',
            isSystem: false,
            sortOrder: 5,
          }),
        }),
      );
    });

    it('rejects a duplicate name (case-insensitive)', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValueOnce({ id: 'dup' });
      await expect(
        service.create(CONDOMINIUM_ID, { name: 'Vigilancia' }, USER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.expenseCategory.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('refuses to delete a system category', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValueOnce({
        id: 'cat-sys',
        condominiumId: CONDOMINIUM_ID,
        isSystem: true,
      });
      await expect(service.remove(CONDOMINIUM_ID, 'cat-sys', USER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.expenseCategory.update).not.toHaveBeenCalled();
    });

    it('soft-deletes a custom category', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValueOnce({
        id: 'cat-1',
        condominiumId: CONDOMINIUM_ID,
        isSystem: false,
      });
      prisma.expenseCategory.update.mockResolvedValue({ id: 'cat-1' });
      await service.remove(CONDOMINIUM_ID, 'cat-1', USER_ID);
      expect(prisma.expenseCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cat-1' },
          data: expect.objectContaining({ isActive: false, deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('404s when the category is not in the tenant', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValueOnce(null);
      await expect(service.remove(CONDOMINIUM_ID, 'nope', USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('rejects a list that does not match the stored set', async () => {
      prisma.expenseCategory.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      await expect(
        service.reorder(CONDOMINIUM_ID, ['a'], USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists the new order when the set matches', async () => {
      prisma.expenseCategory.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]) // membership check
        .mockResolvedValueOnce([]); // final read
      prisma.expenseCategory.update.mockResolvedValue({});
      await service.reorder(CONDOMINIUM_ID, ['b', 'a'], USER_ID);
      expect(prisma.expenseCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b' }, data: expect.objectContaining({ sortOrder: 0 }) }),
      );
      expect(prisma.expenseCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a' }, data: expect.objectContaining({ sortOrder: 1 }) }),
      );
    });
  });
});
