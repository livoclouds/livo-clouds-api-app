import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

function makeDeps() {
  const prisma = {
    user: { findFirst: jest.fn(), updateMany: jest.fn() },
    role: { findFirst: jest.fn() },
  };
  const events = { emit: jest.fn() };
  const rbac = {
    invalidateUser: jest.fn(),
    hasAny: jest.fn(),
    getEffectivePermissions: jest.fn(),
  };
  return { prisma, events, rbac };
}

const requester = { sub: 'actor', role: 'ROOT' } as never;

describe('UsersService.update — permission overrides (RBAC Phase 3)', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: UsersService;

  beforeEach(() => {
    deps = makeDeps();
    service = new UsersService(
      deps.prisma as never,
      deps.events as never,
      deps.rbac as never,
    );
    // Same role before/after (no role change) so no permissions event fires.
    const row = {
      id: 'u1',
      roleRef: { key: 'TENANT_ADMIN' },
      permissionOverrides: null,
    };
    deps.prisma.user.findFirst
      .mockResolvedValueOnce(row) // findOne(before)
      .mockResolvedValueOnce({ ...row }); // after
    deps.prisma.user.updateMany.mockResolvedValue({ count: 1 });
    // ROOT holds all permissions — gates 1, 2, and 3 pass.
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.rbac.getEffectivePermissions.mockResolvedValue(
      new Set([
        'audit.read',
        'platform.roles.manage',
        'platform.users.manage',
        'users.permissions.manage',
      ]),
    );
  });

  it('persists a sanitised override array and invalidates the cache', async () => {
    await service.update(
      'c1',
      'u1',
      { permissionOverrides: ['audit.read', 'bogus.key'] } as never,
      requester,
    );

    expect(deps.prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ permissionOverrides: ['audit.read'] }),
      }),
    );
    expect(deps.rbac.invalidateUser).toHaveBeenCalledWith('u1');
  });

  it('resets overrides to inherit (DbNull) when null', async () => {
    await service.update(
      'c1',
      'u1',
      { permissionOverrides: null } as never,
      requester,
    );

    expect(deps.prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          permissionOverrides: Prisma.DbNull,
        }),
      }),
    );
  });

  it('leaves overrides untouched when the key is absent', async () => {
    await service.update('c1', 'u1', { firstName: 'New' } as never, requester);

    const call = deps.prisma.user.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect('permissionOverrides' in call.data).toBe(false);
  });
});

describe('RBAC-001: permissionOverrides security gates', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: UsersService;

  const tenantAdmin = { sub: 'ta', role: 'TENANT_ADMIN' } as never;
  const rootUser = { sub: 'root', role: 'ROOT' } as never;

  beforeEach(() => {
    deps = makeDeps();
    service = new UsersService(
      deps.prisma as never,
      deps.events as never,
      deps.rbac as never,
    );
    const row = { id: 'u1', roleRef: { key: 'TENANT_ADMIN' }, permissionOverrides: null };
    deps.prisma.user.findFirst.mockResolvedValue(row);
    deps.prisma.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects actor lacking users.permissions.manage', async () => {
    deps.rbac.hasAny.mockResolvedValue(false);
    await expect(
      service.update('c1', 'u1', { permissionOverrides: ['audit.read'] } as never, tenantAdmin),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects platform.* override from a tenant-scoped actor', async () => {
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.rbac.getEffectivePermissions.mockResolvedValue(new Set(['audit.read']));
    await expect(
      service.update(
        'c1',
        'u1',
        { permissionOverrides: ['platform.roles.manage'] } as never,
        tenantAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects granting a permission the actor does not hold', async () => {
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.rbac.getEffectivePermissions.mockResolvedValue(new Set(['audit.read']));
    await expect(
      service.update('c1', 'u1', { permissionOverrides: ['users.manage'] } as never, tenantAdmin),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows ROOT to set a tenant-scoped override', async () => {
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.rbac.getEffectivePermissions.mockResolvedValue(
      new Set(['audit.read', 'users.manage', 'users.permissions.manage', 'platform.users.manage']),
    );
    deps.prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'u1', roleRef: { key: 'TENANT_ADMIN' }, permissionOverrides: null })
      .mockResolvedValueOnce({ id: 'u1', roleRef: { key: 'TENANT_ADMIN' }, permissionOverrides: ['audit.read'] });
    await expect(
      service.update('c1', 'u1', { permissionOverrides: ['audit.read'] } as never, rootUser),
    ).resolves.not.toThrow();
  });

  it('allows ROOT to set a platform-scoped override', async () => {
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.rbac.getEffectivePermissions.mockResolvedValue(
      new Set(['platform.roles.manage', 'platform.users.manage', 'users.permissions.manage']),
    );
    deps.prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'u1', roleRef: { key: 'ROOT' }, permissionOverrides: null })
      .mockResolvedValueOnce({ id: 'u1', roleRef: { key: 'ROOT' }, permissionOverrides: ['platform.roles.manage'] });
    await expect(
      service.update(
        'c1',
        'u1',
        { permissionOverrides: ['platform.roles.manage'] } as never,
        rootUser,
      ),
    ).resolves.not.toThrow();
  });
});

describe('RBAC-002: role assignment security gates', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: UsersService;

  const tenantAdmin = { sub: 'ta', role: 'TENANT_ADMIN' } as never;
  const rootUser = { sub: 'root', role: 'ROOT' } as never;

  beforeEach(() => {
    deps = makeDeps();
    service = new UsersService(
      deps.prisma as never,
      deps.events as never,
      deps.rbac as never,
    );
  });

  it('rejects creating ROOT when actor lacks platform.users.manage', async () => {
    deps.rbac.hasAny.mockResolvedValue(false);
    await expect(
      service.create(
        'c1',
        { role: 'ROOT', email: 'x@x.com', password: 'pw', firstName: 'A', lastName: 'B' } as never,
        tenantAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows ROOT to create a ROOT user', async () => {
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.prisma.user.findFirst.mockResolvedValue(null); // no email conflict
    deps.prisma.role.findFirst.mockResolvedValue({ id: 'role-root', key: 'ROOT' });
    (deps.prisma.user as Record<string, unknown>).create = jest.fn().mockResolvedValue({
      id: 'u2',
      email: 'root@x.com',
      roleRef: { key: 'ROOT' },
      permissionOverrides: null,
    });
    await expect(
      service.create(
        'c1',
        { role: 'ROOT', email: 'root@x.com', password: 'pw12345!', firstName: 'A', lastName: 'B' } as never,
        rootUser,
      ),
    ).resolves.not.toThrow();
  });

  it('[RBAC-006] create: condominiumId is threaded into prisma.user.create data', async () => {
    deps.rbac.hasAny.mockResolvedValue(true);
    deps.prisma.user.findFirst.mockResolvedValue(null); // no email conflict
    deps.prisma.role.findFirst.mockResolvedValue({ id: 'role-ta', key: 'TENANT_ADMIN' });
    const createMock = jest.fn().mockResolvedValue({
      id: 'u-new',
      email: 'new@x.com',
      roleRef: { key: 'TENANT_ADMIN' },
      permissionOverrides: null,
    });
    (deps.prisma.user as Record<string, unknown>).create = createMock;
    await service.create(
      'condo-target',
      { role: 'TENANT_ADMIN', email: 'new@x.com', password: 'pw12345!', firstName: 'A', lastName: 'B' } as never,
      rootUser,
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ condominiumId: 'condo-target' }),
      }),
    );
  });
});

// RBAC-011: cross-tenant isolation — the service must scope every read/write to
// the condominiumId passed in the call. An actor from condo-a cannot see or
// mutate condo-b resources even when it knows their IDs.
describe('cross-tenant isolation (users)', () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: UsersService;

  const tenantAdminA = { sub: 'ta-a', role: 'TENANT_ADMIN' } as never;

  beforeEach(() => {
    deps = makeDeps();
    service = new UsersService(
      deps.prisma as never,
      deps.events as never,
      deps.rbac as never,
    );
    // Simulate the condominiumId-scoped WHERE clause returning nothing.
    deps.prisma.user.findFirst.mockResolvedValue(null);
    deps.prisma.user.updateMany.mockResolvedValue({ count: 0 });
  });

  it('findOne: 404 when user does not belong to the requested condominium', async () => {
    await expect(service.findOne('condo-a', 'u-from-condo-b')).rejects.toThrow(NotFoundException);
  });

  it('update: 404 when user does not belong to the requested condominium', async () => {
    await expect(
      service.update('condo-a', 'u-from-condo-b', { firstName: 'Hacked' } as never, tenantAdminA),
    ).rejects.toThrow(NotFoundException);
    expect(deps.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('remove: 404 when user does not belong to the requested condominium', async () => {
    await expect(service.remove('condo-a', 'u-from-condo-b')).rejects.toThrow(NotFoundException);
  });
});
