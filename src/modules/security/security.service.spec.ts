import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SecurityService } from './security.service';

function makeDeps() {
  const prisma = {
    visitorLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    resident: { findFirst: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { prisma, audit };
}

const CONDO = 'condo-1';
const USER = 'guard-1';

describe('SecurityService — visitor logs', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: SecurityService;

  beforeEach(() => {
    deps = makeDeps();
    service = new SecurityService(deps.prisma as never, deps.audit as never);
  });

  describe('findAllVisitors', () => {
    it('filters active visits (checkOutAt null) and paginates', async () => {
      deps.prisma.visitorLog.findMany.mockResolvedValue([{ id: 'v1' }]);
      deps.prisma.visitorLog.count.mockResolvedValue(1);

      const res = await service.findAllVisitors(CONDO, {
        status: 'active',
        page: 1,
        limit: 50,
      });

      const args = deps.prisma.visitorLog.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        condominiumId: CONDO,
        deletedAt: null,
        checkOutAt: null,
      });
      expect(res.meta).toEqual({ total: 1, page: 1, limit: 50, totalPages: 1 });
    });

    it('filters completed visits (checkOutAt not null)', async () => {
      deps.prisma.visitorLog.findMany.mockResolvedValue([]);
      deps.prisma.visitorLog.count.mockResolvedValue(0);
      await service.findAllVisitors(CONDO, { status: 'completed' });
      const args = deps.prisma.visitorLog.findMany.mock.calls[0][0];
      expect(args.where.checkOutAt).toEqual({ not: null });
    });
  });

  describe('createVisitor', () => {
    it('creates a check-in and writes an audit row', async () => {
      deps.prisma.visitorLog.create.mockResolvedValue({
        id: 'v1',
        visitorName: 'Juan',
        unit: 'A-101',
      });
      const res = await service.createVisitor(CONDO, USER, {
        visitorName: 'Juan',
        unit: 'A-101',
      });
      expect(deps.prisma.visitorLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            condominiumId: CONDO,
            visitorName: 'Juan',
            unit: 'A-101',
            createdBy: USER,
            updatedBy: USER,
          }),
        }),
      );
      expect(deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VISITOR_CHECKED_IN' }),
      );
      expect(res.id).toBe('v1');
    });

    it('rejects a residentId from another condominium', async () => {
      deps.prisma.resident.findFirst.mockResolvedValue(null);
      await expect(
        service.createVisitor(CONDO, USER, {
          visitorName: 'Juan',
          unit: 'A-101',
          residentId: 'r-other',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(deps.prisma.visitorLog.create).not.toHaveBeenCalled();
    });
  });

  describe('updateVisitor', () => {
    it('records a first-time check-out with the VISITOR_CHECKED_OUT action', async () => {
      deps.prisma.visitorLog.findFirst.mockResolvedValue({
        id: 'v1',
        checkOutAt: null,
      });
      deps.prisma.visitorLog.update.mockResolvedValue({ id: 'v1' });
      await service.updateVisitor(CONDO, USER, 'v1', {
        checkOutAt: '2026-06-01T15:00:00.000Z',
      });
      const data = deps.prisma.visitorLog.update.mock.calls[0][0].data;
      expect(data.checkOutAt).toBeInstanceOf(Date);
      expect(deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VISITOR_CHECKED_OUT' }),
      );
    });

    it('treats a non-checkout edit as VISITOR_UPDATED', async () => {
      deps.prisma.visitorLog.findFirst.mockResolvedValue({
        id: 'v1',
        checkOutAt: null,
      });
      deps.prisma.visitorLog.update.mockResolvedValue({ id: 'v1' });
      await service.updateVisitor(CONDO, USER, 'v1', { notes: 'edited' });
      expect(deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VISITOR_UPDATED' }),
      );
    });

    it('throws when the visit does not exist', async () => {
      deps.prisma.visitorLog.findFirst.mockResolvedValue(null);
      await expect(
        service.updateVisitor(CONDO, USER, 'ghost', { notes: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeVisitor', () => {
    it('soft-deletes and audits', async () => {
      deps.prisma.visitorLog.updateMany.mockResolvedValue({ count: 1 });
      const res = await service.removeVisitor(CONDO, USER, 'v1');
      expect(deps.prisma.visitorLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v1', condominiumId: CONDO, deletedAt: null },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VISITOR_DELETED' }),
      );
      expect(res).toEqual({ id: 'v1', deleted: true });
    });

    it('throws when nothing was deleted', async () => {
      deps.prisma.visitorLog.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.removeVisitor(CONDO, USER, 'ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
