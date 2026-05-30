import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

function makeDeps() {
  const prisma = {
    user: { findFirst: jest.fn(), updateMany: jest.fn() },
    role: { findFirst: jest.fn() },
  };
  const events = { emit: jest.fn() };
  const rbac = { invalidateUser: jest.fn() };
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
