import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RbacService } from '../../common/rbac/rbac.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesService } from './roles.service';

const CONDO = 'condo-1';

interface PrismaMock {
  role: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  user: { groupBy: jest.Mock; count: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    role: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      groupBy: jest.fn(),
      count: jest.fn(),
    },
  };
}

describe('RolesService', () => {
  let prisma: PrismaMock;
  let rbac: { invalidateAll: jest.Mock; invalidateUser: jest.Mock };
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    rbac = { invalidateAll: jest.fn(), invalidateUser: jest.fn() };
    service = new RolesService(
      prisma as unknown as PrismaService,
      rbac as unknown as RbacService,
    );
  });

  describe('findAll', () => {
    it('returns system + custom roles with assigned-user counts', async () => {
      prisma.role.findMany.mockResolvedValue([
        { id: 'r-sys', isSystem: true, name: 'Administrator' },
        { id: 'r-custom', isSystem: false, name: 'Council' },
      ]);
      prisma.user.groupBy.mockResolvedValue([
        { roleId: 'r-sys', _count: { _all: 3 } },
      ]);

      const result = await service.findAll(CONDO);

      expect(result).toEqual([
        { id: 'r-sys', isSystem: true, name: 'Administrator', userCount: 3 },
        { id: 'r-custom', isSystem: false, name: 'Council', userCount: 0 },
      ]);
    });
  });

  describe('create', () => {
    it('rejects unknown permission keys', async () => {
      await expect(
        service.create(CONDO, {
          name: 'Bad',
          permissions: ['dashboard.read', 'totally.fake'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it('creates a condominium-scoped custom role with sanitized permissions', async () => {
      prisma.role.create.mockResolvedValue({ id: 'new' });
      await service.create(CONDO, {
        name: 'Council',
        description: 'Board',
        permissions: ['reports.read', 'reports.read', 'dashboard.read'],
      });
      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Council',
            isSystem: false,
            condominiumId: CONDO,
            permissions: ['reports.read', 'dashboard.read'],
          }),
        }),
      );
      expect(rbac.invalidateAll).toHaveBeenCalled();
    });

    it('maps a unique-constraint violation to a Conflict', async () => {
      prisma.role.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.create(CONDO, { name: 'Council', permissions: ['reports.read'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('refuses to modify a system role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r-sys', isSystem: true });
      await expect(
        service.update(CONDO, 'r-sys', { name: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('validates permissions on update', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r1', isSystem: false });
      await expect(
        service.update(CONDO, 'r1', { permissions: ['nope.read'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates a custom role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r1', isSystem: false });
      prisma.role.update.mockResolvedValue({ id: 'r1' });
      await service.update(CONDO, 'r1', {
        name: 'Renamed',
        permissions: ['dashboard.read'],
      });
      expect(prisma.role.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({
            name: 'Renamed',
            permissions: ['dashboard.read'],
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a system role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r-sys', isSystem: true });
      await expect(service.remove(CONDO, 'r-sys')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('blocks deletion while users are assigned', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r1', isSystem: false });
      prisma.user.count.mockResolvedValue(2);
      await expect(service.remove(CONDO, 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('soft-deletes an unused custom role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r1', isSystem: false });
      prisma.user.count.mockResolvedValue(0);
      prisma.role.update.mockResolvedValue({ id: 'r1' });
      await service.remove(CONDO, 'r1');
      expect(prisma.role.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(rbac.invalidateAll).toHaveBeenCalled();
    });

    it('throws NotFound for a missing role', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(service.remove(CONDO, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // RBAC-011: cross-tenant isolation — custom roles are scoped to their
  // condominium. An actor passing a foreign condominiumId must receive 404,
  // not a forbidden data leak.
  describe('cross-tenant isolation (roles)', () => {
    beforeEach(() => {
      // findFirst returns null — simulates no match for this (slug, id) pair.
      prisma.role.findFirst.mockResolvedValue(null);
    });

    it('findOne: 404 when role is not in the requested condominium', async () => {
      await expect(service.findOne('condo-a', 'role-from-condo-b')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('update: 404 when custom role belongs to a different condominium', async () => {
      await expect(service.update('condo-a', 'role-from-condo-b', { name: 'Hijacked' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });

    it('remove: 404 when custom role belongs to a different condominium', async () => {
      await expect(service.remove('condo-a', 'role-from-condo-b')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });
  });
});
