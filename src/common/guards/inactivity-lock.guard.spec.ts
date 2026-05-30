import { HttpException } from '@nestjs/common';
import { InactivityLockGuard } from './inactivity-lock.guard';

function makeContext(user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function makeReflector(values: { public?: boolean; skip?: boolean }) {
  return {
    getAllAndOverride: jest.fn((key: string) =>
      key === 'isPublic'
        ? values.public
        : key === 'skipInactivityLock'
          ? values.skip
          : undefined,
    ),
  };
}

interface PrismaMock {
  refreshToken: { findUnique: jest.Mock; update: jest.Mock };
}

function makePrisma(session: unknown): PrismaMock {
  return {
    refreshToken: {
      findUnique: jest.fn(() => Promise.resolve(session)),
      update: jest.fn(() => Promise.resolve({})),
    },
  };
}

function makeGuard(reflector: unknown, prisma: PrismaMock): InactivityLockGuard {
  return new InactivityLockGuard(reflector as never, prisma as never);
}

const USER = { sub: 'u1', sid: 's1' };

async function expectLocked(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect((thrown as HttpException).getStatus()).toBe(423);
}

describe('InactivityLockGuard', () => {
  it('allows public routes without touching the session', async () => {
    const prisma = makePrisma(null);
    const guard = makeGuard(makeReflector({ public: true }), prisma);
    await expect(guard.canActivate(makeContext(USER))).resolves.toBe(true);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('allows whitelisted (skip-decorated) routes', async () => {
    const prisma = makePrisma(null);
    const guard = makeGuard(makeReflector({ skip: true }), prisma);
    await expect(guard.canActivate(makeContext(USER))).resolves.toBe(true);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('allows a token without a sid (pre-feature rollout)', async () => {
    const prisma = makePrisma(null);
    const guard = makeGuard(makeReflector({}), prisma);
    await expect(
      guard.canActivate(makeContext({ sub: 'u1' })),
    ).resolves.toBe(true);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects with 423 when the session is explicitly locked', async () => {
    const prisma = makePrisma({
      lockedAt: new Date(),
      lastActivityAt: new Date(),
      revokedAt: null,
      user: { inactivityLockMinutes: 15 },
    });
    const guard = makeGuard(makeReflector({}), prisma);
    await expectLocked(guard.canActivate(makeContext(USER)));
  });

  it('locks and persists lockedAt when idle past the threshold', async () => {
    const stale = new Date(Date.now() - 16 * 60_000);
    const prisma = makePrisma({
      lockedAt: null,
      lastActivityAt: stale,
      revokedAt: null,
      user: { inactivityLockMinutes: 15 },
    });
    const guard = makeGuard(makeReflector({}), prisma);
    await expectLocked(guard.canActivate(makeContext(USER)));
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
  });

  it('allows an active session within the threshold', async () => {
    const recent = new Date(Date.now() - 60_000);
    const prisma = makePrisma({
      lockedAt: null,
      lastActivityAt: recent,
      revokedAt: null,
      user: { inactivityLockMinutes: 15 },
    });
    const guard = makeGuard(makeReflector({}), prisma);
    await expect(guard.canActivate(makeContext(USER))).resolves.toBe(true);
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
  });

  it('ignores a revoked session and defers to the auth flow', async () => {
    const prisma = makePrisma({
      lockedAt: new Date(),
      lastActivityAt: new Date(),
      revokedAt: new Date(),
      user: { inactivityLockMinutes: 15 },
    });
    const guard = makeGuard(makeReflector({}), prisma);
    await expect(guard.canActivate(makeContext(USER))).resolves.toBe(true);
  });
});
