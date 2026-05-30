import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from './rbac.service';

function makePrismaMock() {
  return { user: { findUnique: jest.fn() } };
}

describe('RbacService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: RbacService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new RbacService(prisma as unknown as PrismaService);
  });

  it('resolves effective permissions from the assigned role', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'TENANT_ADMIN',
      roleRef: { permissions: ['users.read', 'residents.manage'] },
    });
    const perms = await service.getEffectivePermissions('u1');
    expect([...perms].sort()).toEqual(['residents.manage', 'users.read']);
  });

  it('grants no permissions when the user has no role row', async () => {
    prisma.user.findUnique.mockResolvedValue({ roleRef: null });
    const perms = await service.getEffectivePermissions('u1');
    expect(perms.size).toBe(0);
  });

  it('per-user overrides take precedence over the role (RBAC Phase 3)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      permissionOverrides: ['audit.read'],
      roleRef: { permissions: ['users.read', 'residents.manage'] },
    });
    const perms = await service.getEffectivePermissions('u1');
    expect([...perms]).toEqual(['audit.read']);
  });

  it('null overrides inherit the role', async () => {
    prisma.user.findUnique.mockResolvedValue({
      permissionOverrides: null,
      roleRef: { permissions: ['dashboard.read'] },
    });
    const perms = await service.getEffectivePermissions('u1');
    expect([...perms]).toEqual(['dashboard.read']);
  });

  it('returns no permissions for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const perms = await service.getEffectivePermissions('ghost');
    expect(perms.size).toBe(0);
  });

  it('caches the result (second call does not hit the DB)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ROOT',
      roleRef: { permissions: ['dashboard.read'] },
    });
    await service.getEffectivePermissions('u1');
    await service.getEffectivePermissions('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidateUser forces a re-fetch', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ROOT',
      roleRef: { permissions: ['dashboard.read'] },
    });
    await service.getEffectivePermissions('u1');
    service.invalidateUser('u1');
    await service.getEffectivePermissions('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll clears every cached user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ROOT',
      roleRef: { permissions: ['dashboard.read'] },
    });
    await service.getEffectivePermissions('u1');
    await service.getEffectivePermissions('u2');
    service.invalidateAll();
    await service.getEffectivePermissions('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(3);
  });

  describe('hasAny', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'TENANT_ADMIN',
        roleRef: { permissions: ['users.read', 'users.manage'] },
      });
    });

    it('returns true when any required key is held', async () => {
      await expect(
        service.hasAny('u1', ['users.read', 'platform.users.manage']),
      ).resolves.toBe(true);
    });

    it('returns false when none are held', async () => {
      await expect(
        service.hasAny('u1', ['platform.users.manage']),
      ).resolves.toBe(false);
    });

    it('returns true for an empty requirement list', async () => {
      await expect(service.hasAny('u1', [])).resolves.toBe(true);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
