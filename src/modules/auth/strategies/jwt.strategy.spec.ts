import { UnauthorizedException } from '@nestjs/common';
import { UserRole, type JwtPayload } from '../../../common/types';
import { JwtStrategy } from './jwt.strategy';

interface PrismaMock {
  user: {
    findFirst: jest.Mock;
  };
}

interface ConfigMock {
  get: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    user: { findFirst: jest.fn() },
  };
}

function makeConfigMock(): ConfigMock {
  return {
    get: jest.fn((key: string) => {
      if (key === 'jwt.secret') return 'test-jwt-secret';
      return undefined;
    }),
  };
}

function makeStrategy(
  prisma: PrismaMock = makePrismaMock(),
  config: ConfigMock = makeConfigMock(),
): JwtStrategy {
  return new JwtStrategy(config as never, prisma as never);
}

function basePayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-uuid-1',
    email: 'user@test.local',
    role: UserRole.TENANT_ADMIN,
    condominiumId: 'cond-uuid-1',
    condominiumSlug: 'test-condo',
    ...overrides,
  };
}

describe('JwtStrategy.validate', () => {
  let prisma: PrismaMock;
  let strategy: JwtStrategy;

  beforeEach(() => {
    prisma = makePrismaMock();
    strategy = makeStrategy(prisma);
  });

  it('returns the payload unchanged for an active, non-deleted user', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-1' });
    const payload = basePayload();

    const result = await strategy.validate(payload);

    expect(result).toBe(payload);
  });

  it('queries the database by sub, isActive: true, and deletedAt: null', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-1' });
    const payload = basePayload();

    await strategy.validate(payload);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-uuid-1', isActive: true, deletedAt: null },
      }),
    );
  });

  it('throws UnauthorizedException when user is not found', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(strategy.validate(basePayload())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException for inactive users', async () => {
    // The query uses { isActive: true } — inactive users return null from findFirst.
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      strategy.validate(basePayload({ sub: 'inactive-user-uuid' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for soft-deleted users', async () => {
    // The query uses { deletedAt: null } — soft-deleted users return null from findFirst.
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      strategy.validate(basePayload({ sub: 'deleted-user-uuid' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('does not add extra fields to the returned payload', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-1' });
    const payload = basePayload();

    const result = await strategy.validate(payload);

    // Only the original payload fields should be present
    const allowedKeys = new Set(['sub', 'email', 'role', 'condominiumId', 'condominiumSlug', 'iat', 'exp']);
    const extraKeys = Object.keys(result).filter((k) => !allowedKeys.has(k));
    expect(extraKeys).toHaveLength(0);
  });

  it('works for ROOT role with null condominiumId and condominiumSlug', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'root-uuid-1' });
    const payload = basePayload({
      sub: 'root-uuid-1',
      role: UserRole.ROOT,
      condominiumId: null,
      condominiumSlug: null,
    });

    const result = await strategy.validate(payload);

    expect(result.role).toBe(UserRole.ROOT);
    expect(result.condominiumId).toBeNull();
    expect(result.condominiumSlug).toBeNull();
  });
});
