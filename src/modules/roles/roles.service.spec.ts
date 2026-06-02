import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RbacService } from '../../common/rbac/rbac.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
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
  let storage: { isConfigured: jest.Mock; getPresignedUrl: jest.Mock };
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    rbac = { invalidateAll: jest.fn(), invalidateUser: jest.fn() };
    storage = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPresignedUrl: jest.fn(),
    };
    service = new RolesService(
      prisma as unknown as PrismaService,
      rbac as unknown as RbacService,
      storage as unknown as StorageService,
    );
  });

  describe('findAll', () => {
    it('returns system + custom roles with assigned-user counts and empty sampleUsers', async () => {
      prisma.role.findMany.mockResolvedValue([
        { id: 'r-sys', isSystem: true, name: 'Administrator', users: [] },
        { id: 'r-custom', isSystem: false, name: 'Council', users: [] },
      ]);
      prisma.user.groupBy.mockResolvedValue([
        { roleId: 'r-sys', _count: { _all: 3 } },
      ]);

      const result = await service.findAll(CONDO);

      expect(result).toEqual([
        { id: 'r-sys', isSystem: true, name: 'Administrator', userCount: 3, sampleUsers: [] },
        { id: 'r-custom', isSystem: false, name: 'Council', userCount: 0, sampleUsers: [] },
      ]);
    });

    it('builds sampleUsers: passes through absolute URLs and presigns R2 keys without access-logging', async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          id: 'r-sys',
          isSystem: true,
          name: 'Administrator',
          users: [
            { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', avatarUrl: 'condominiums/c/users/u1/avatar.png' },
            { id: 'u2', firstName: 'Alan', lastName: 'Turing', avatarUrl: 'https://cdn.example.com/u2.png' },
            { id: 'u3', firstName: 'Grace', lastName: 'Hopper', avatarUrl: null },
          ],
        },
      ]);
      prisma.user.groupBy.mockResolvedValue([{ roleId: 'r-sys', _count: { _all: 9 } }]);
      storage.getPresignedUrl.mockResolvedValue('https://signed.example.com/u1.png');

      const result = await service.findAll(CONDO);

      expect(result[0].userCount).toBe(9); // total, not truncated to 3
      expect(result[0].sampleUsers).toEqual([
        { id: 'u1', name: 'Ada Lovelace', avatarUrl: 'https://signed.example.com/u1.png' },
        { id: 'u2', name: 'Alan Turing', avatarUrl: 'https://cdn.example.com/u2.png' },
        { id: 'u3', name: 'Grace Hopper', avatarUrl: null },
      ]);
      // Only the R2 key is presigned, and logging is disabled (4th arg false).
      expect(storage.getPresignedUrl).toHaveBeenCalledTimes(1);
      expect(storage.getPresignedUrl).toHaveBeenCalledWith(
        'condominiums/c/users/u1/avatar.png',
        3600,
        { condominiumId: CONDO },
        false,
      );
    });

    it('scopes the user count and sample users to the requested condominium', async () => {
      prisma.role.findMany.mockResolvedValue([
        { id: 'r-sys', isSystem: true, name: 'Administrator', users: [] },
      ]);
      prisma.user.groupBy.mockResolvedValue([{ roleId: 'r-sys', _count: { _all: 1 } }]);

      await service.findAll(CONDO);

      // Count is filtered by condominiumId so the badge matches the modal's
      // condominium-scoped user list (Root etc. with condominiumId=null → 0).
      expect(prisma.user.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ condominiumId: CONDO }),
        }),
      );
      // The sampleUsers relation is filtered by condominiumId too.
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            users: expect.objectContaining({
              where: expect.objectContaining({ condominiumId: CONDO }),
            }),
          }),
        }),
      );
    });

    it('returns null avatarUrl for R2 keys when storage is not configured', async () => {
      storage.isConfigured.mockReturnValue(false);
      prisma.role.findMany.mockResolvedValue([
        {
          id: 'r-sys',
          isSystem: true,
          name: 'Administrator',
          users: [{ id: 'u1', firstName: 'Ada', lastName: 'Lovelace', avatarUrl: 'key/u1.png' }],
        },
      ]);
      prisma.user.groupBy.mockResolvedValue([]);

      const result = await service.findAll(CONDO);

      expect(result[0].sampleUsers).toEqual([{ id: 'u1', name: 'Ada Lovelace', avatarUrl: null }]);
      expect(storage.getPresignedUrl).not.toHaveBeenCalled();
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

    it('[RBAC-006] creates a condominium-scoped custom role with sanitized permissions (condominiumId in data)', async () => {
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
