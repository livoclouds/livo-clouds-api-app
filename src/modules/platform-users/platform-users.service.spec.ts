import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformUsersService } from './platform-users.service';
import { UserRole } from '../../common/types';

function makeDeps() {
  const prisma = {
    user: { findFirst: jest.fn(), update: jest.fn() },
    condominium: { findFirst: jest.fn() },
    role: { findFirst: jest.fn() },
  };
  const rbac = { invalidateUser: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { prisma, rbac, audit };
}

const requester = { sub: 'actor-1' } as never;

describe('PlatformUsersService.move', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: PlatformUsersService;

  beforeEach(() => {
    deps = makeDeps();
    service = new PlatformUsersService(
      deps.prisma as never,
      deps.rbac as never,
      deps.audit as never,
    );
  });

  it('rejects when the user is not found', async () => {
    deps.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.move('ghost', { condominiumId: 'c2' }, requester),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects moving a ROOT / platform user', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: null,
      roleId: 'r-root',
      roleRef: { key: UserRole.ROOT, isSystem: true },
    });
    await expect(
      service.move('u1', { condominiumId: 'c2' }, requester),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects moving to the same condominium', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c1',
      roleId: 'r1',
      roleRef: { key: UserRole.TENANT_ADMIN, isSystem: true },
    });
    await expect(
      service.move('u1', { condominiumId: 'c1' }, requester),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the destination condominium does not exist', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c1',
      roleId: 'r1',
      roleRef: { key: UserRole.TENANT_ADMIN, isSystem: true },
    });
    deps.prisma.condominium.findFirst.mockResolvedValue(null);
    await expect(
      service.move('u1', { condominiumId: 'c2' }, requester),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps a system role and changes condominiumId', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c1',
      roleId: 'r-admin',
      roleRef: { key: UserRole.TENANT_ADMIN, isSystem: true },
    });
    deps.prisma.condominium.findFirst.mockResolvedValue({ id: 'c2' });
    deps.prisma.user.update.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c2',
      roleId: 'r-admin',
    });

    const res = await service.move('u1', { condominiumId: 'c2' }, requester);

    expect(deps.prisma.role.findFirst).not.toHaveBeenCalled();
    expect(deps.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { condominiumId: 'c2', roleId: 'r-admin' },
      }),
    );
    expect(deps.rbac.invalidateUser).toHaveBeenCalledWith('u1');
    expect(res.condominiumId).toBe('c2');
  });

  it('resets a custom (source-scoped) role to the system Administrator role', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c1',
      roleId: 'r-custom',
      roleRef: { key: null, isSystem: false },
    });
    deps.prisma.condominium.findFirst.mockResolvedValue({ id: 'c2' });
    deps.prisma.role.findFirst.mockResolvedValue({ id: 'r-admin-sys' });
    deps.prisma.user.update.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c2',
      roleId: 'r-admin-sys',
    });

    await service.move('u1', { condominiumId: 'c2' }, requester);

    expect(deps.prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: UserRole.TENANT_ADMIN, isSystem: true },
        select: { id: true },
      }),
    );
    expect(deps.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { condominiumId: 'c2', roleId: 'r-admin-sys' },
      }),
    );
  });

  it('uses an explicit destination roleId when provided', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c1',
      roleId: 'r-custom',
      roleRef: { key: null, isSystem: false },
    });
    deps.prisma.condominium.findFirst.mockResolvedValue({ id: 'c2' });
    deps.prisma.role.findFirst.mockResolvedValue({ id: 'r-target' });
    deps.prisma.user.update.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c2',
      roleId: 'r-target',
    });

    await service.move(
      'u1',
      { condominiumId: 'c2', roleId: 'r-target' },
      requester,
    );

    expect(deps.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { condominiumId: 'c2', roleId: 'r-target' },
      }),
    );
  });

  it('maps a duplicate-email collision to ConflictException', async () => {
    deps.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      condominiumId: 'c1',
      roleId: 'r-admin',
      roleRef: { key: UserRole.TENANT_ADMIN, isSystem: true },
    });
    deps.prisma.condominium.findFirst.mockResolvedValue({ id: 'c2' });
    deps.prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.move('u1', { condominiumId: 'c2' }, requester),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
