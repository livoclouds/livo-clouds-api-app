import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '../../common/types';
import { AuthService } from './auth.service';

// Mock bcrypt to avoid slow hash rounds during tests.
// DUMMY_HASH is assigned at class instantiation; this mock keeps it cheap.
jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '$2b$12$test-dummy-hash-placeholder'),
  compare: jest.fn(),
}));

const USER_ID = 'user-uuid-1';
const CONDOMINIUM_ID = 'cond-uuid-1';
const CONDOMINIUM_SLUG = 'test-condo';

interface PrismaMock {
  user: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  refreshToken: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  passwordResetToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface EmailMock {
  sendPasswordResetEmail: jest.Mock;
}

interface AuditMock {
  log: jest.Mock;
}

interface JwtMock {
  sign: jest.Mock;
}

interface ConfigMock {
  get: jest.Mock;
}

interface StorageMock {
  isConfigured: jest.Mock;
  getPresignedUrl: jest.Mock;
  uploadFile: jest.Mock;
  deleteFile: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    refreshToken: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    passwordResetToken: {
      create: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
  return mock;
}

function makeEmailMock(): EmailMock {
  return { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
}

function makeAuditMock(): AuditMock {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeJwtMock(): JwtMock {
  return { sign: jest.fn().mockReturnValue('test-token') };
}

function makeConfigMock(): ConfigMock {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        'jwt.refreshSecret': 'test-refresh-secret',
        'jwt.refreshExpiresIn': '7d',
      };
      return values[key] ?? defaultValue;
    }),
  };
}

function makeStorageMock(): StorageMock {
  return {
    isConfigured: jest.fn().mockReturnValue(false),
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.test/avatar'),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(
  prisma: PrismaMock,
  audit: AuditMock,
  jwt: JwtMock = makeJwtMock(),
  config: ConfigMock = makeConfigMock(),
  email: EmailMock = makeEmailMock(),
  storage: StorageMock = makeStorageMock(),
): AuthService {
  return new AuthService(
    prisma as never,
    jwt as never,
    config as never,
    audit as never,
    email as never,
    storage as never,
  );
}

function activeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: USER_ID,
    email: 'user@test.local',
    passwordHash: 'stored-password-hash',
    isActive: true,
    deletedAt: null,
    condominiumId: CONDOMINIUM_ID,
    condominium: { slug: CONDOMINIUM_SLUG },
    roleRef: { key: UserRole.TENANT_ADMIN, name: 'Administrator', permissions: [] },
    sessionDuration: 8,
    lastLoginAt: null,
    firstName: 'Test',
    lastName: 'User',
    avatarUrl: null,
    phone: null,
    ...overrides,
  };
}

function activeRootUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return activeUser({
    roleRef: { key: UserRole.ROOT, name: 'Developer', permissions: [] },
    condominiumId: null,
    condominium: null,
    ...overrides,
  });
}

function validStoredToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'token-uuid-1',
    token: 'valid-refresh-token',
    userId: USER_ID,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    user: activeUser(),
    ...overrides,
  };
}

function revokedStoredToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return validStoredToken({ revokedAt: new Date('2026-05-01T00:00:00Z'), ...overrides });
}

function expiredStoredToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return validStoredToken({ expiresAt: new Date('2026-01-01T00:00:00Z'), ...overrides });
}

describe('AuthService', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let jwt: JwtMock;
  let email: EmailMock;
  let service: AuthService;
  const bcryptCompare = bcrypt.compare as jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    jwt = makeJwtMock();
    email = makeEmailMock();
    service = makeService(prisma, audit, jwt, makeConfigMock(), email);
    bcryptCompare.mockReset();
  });

  // ---------------------------------------------------------------------------
  describe('login', () => {
    it('returns tokens and user shape on successful login', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);

      const result = await service.login(
        { email: 'user@test.local', password: 'TestPass1!' },
        { ipAddress: '127.0.0.1', requestId: 'req-1' },
      );

      expect(result).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: {
          id: USER_ID,
          email: 'user@test.local',
          role: UserRole.TENANT_ADMIN,
          condominiumId: CONDOMINIUM_ID,
          condominiumSlug: CONDOMINIUM_SLUG,
        },
      });
    });

    it('includes condominiumSlug from associated condominium', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);

      const result = await service.login(
        { email: 'user@test.local', password: 'TestPass1!' },
      );

      expect(result.user.condominiumSlug).toBe(CONDOMINIUM_SLUG);
    });

    it('returns null condominiumSlug for ROOT users with no condominium', async () => {
      prisma.user.findFirst.mockResolvedValue(activeRootUser());
      bcryptCompare.mockResolvedValue(true);

      const result = await service.login(
        { email: 'root@test.local', password: 'TestPass1!' },
      );

      expect(result.user.condominiumSlug).toBeNull();
    });

    it('stores a refresh token in the database on successful login', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);

      await service.login({ email: 'user@test.local', password: 'TestPass1!' });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: USER_ID }),
        }),
      );
    });

    it('throws UnauthorizedException when user is not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);

      await expect(
        service.login({ email: 'ghost@test.local', password: 'TestPass1!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for soft-deleted users (deletedAt query filter)', async () => {
      // The query uses { deletedAt: null } filter — soft-deleted users return null from findFirst.
      prisma.user.findFirst.mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);

      await expect(
        service.login({ email: 'deleted@test.local', password: 'TestPass1!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for inactive users and writes AUTH_LOGIN_FAILED audit', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser({ isActive: false }));

      await expect(
        service.login({ email: 'user@test.local', password: 'TestPass1!' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_FAILED',
          userId: USER_ID,
        }),
      );
    });

    it('throws UnauthorizedException for wrong password and writes AUTH_LOGIN_FAILED audit', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(false);

      await expect(
        service.login({ email: 'user@test.local', password: 'WrongPass!' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_FAILED',
          userId: USER_ID,
        }),
      );
    });

    it('writes AUTH_LOGIN_SUCCESS audit on successful login', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);

      await service.login({ email: 'user@test.local', password: 'TestPass1!' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_SUCCESS',
          result: 'SUCCESS',
          userId: USER_ID,
        }),
      );
    });

    it('does not block login when audit write throws', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);
      audit.log.mockRejectedValue(new Error('DB connection lost'));

      // Must resolve despite audit failure (best-effort audit per LOG-003)
      await expect(
        service.login({ email: 'user@test.local', password: 'TestPass1!' }),
      ).resolves.toMatchObject({ accessToken: expect.any(String) });
    });

    it('does not update lastLoginAt when token generation fails (LOG-013)', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);
      jwt.sign.mockImplementation(() => { throw new Error('JWT signing failed'); });

      await expect(
        service.login({ email: 'user@test.local', password: 'TestPass1!' }),
      ).rejects.toThrow();

      // lastLoginAt update must not have been called
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('runs dummy bcrypt comparison when user is not found (timing attack prevention, LOG-016)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);

      await expect(
        service.login({ email: 'ghost@test.local', password: 'TestPass1!' }),
      ).rejects.toThrow(UnauthorizedException);

      // bcrypt.compare must be called to prevent timing-based email enumeration
      expect(bcryptCompare).toHaveBeenCalled();
    });

    it('updates lastLoginAt on successful login', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());
      bcryptCompare.mockResolvedValue(true);

      await service.login({ email: 'user@test.local', password: 'TestPass1!' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('refresh', () => {
    it('returns new tokens on successful refresh', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(validStoredToken());

      const result = await service.refresh('valid-refresh-token');

      expect(result).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
    });

    it('throws UnauthorizedException when token is not found', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh('unknown-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when token is expired', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(expiredStoredToken());

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revokes the used token before issuing new tokens', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(validStoredToken());

      await service.refresh('valid-refresh-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-uuid-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('revokes the entire token family and throws on reuse detection (LOG-011)', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(revokedStoredToken());

      await expect(service.refresh('already-used-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: USER_ID, revokedAt: null }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('writes AUTH_REFRESH_REUSE_DETECTED audit on reuse (LOG-011)', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(revokedStoredToken());

      await expect(service.refresh('already-used-token')).rejects.toThrow();

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_REFRESH_REUSE_DETECTED' }),
      );
    });

    it('does not block the security response when audit write throws during reuse', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(revokedStoredToken());
      audit.log.mockRejectedValue(new Error('Audit DB unavailable'));

      // Must still throw UnauthorizedException even if audit fails
      await expect(service.refresh('already-used-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('writes AUTH_REFRESH audit on successful refresh', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(validStoredToken());

      await service.refresh('valid-refresh-token');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_REFRESH',
          result: 'SUCCESS',
        }),
      );
    });

    it('does not block refresh when audit write throws', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(validStoredToken());
      audit.log.mockRejectedValue(new Error('Audit DB unavailable'));

      await expect(service.refresh('valid-refresh-token')).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('logout', () => {
    it('revokes the token and writes AUTH_LOGOUT audit', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        userId: USER_ID,
        user: { condominiumId: CONDOMINIUM_ID },
      });

      await service.logout('valid-refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'valid-refresh-token', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_LOGOUT', result: 'SUCCESS' }),
      );
    });

    it('still calls updateMany when token is not found (idempotent no-op)', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await service.logout('unknown-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('does not throw when token is not found', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.logout('unknown-token')).resolves.toBeUndefined();
    });

    it('does not write audit log when token is not found (no userId available)', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await service.logout('unknown-token');

      expect(audit.log).not.toHaveBeenCalled();
    });

    it('does not block logout when audit write throws', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        userId: USER_ID,
        user: { condominiumId: CONDOMINIUM_ID },
      });
      audit.log.mockRejectedValue(new Error('Audit DB unavailable'));

      await expect(service.logout('valid-refresh-token')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getMe', () => {
    it('returns user shape without tokens for an active user', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser());

      const result = await service.getMe(USER_ID);

      expect(result).toMatchObject({
        id: USER_ID,
        email: 'user@test.local',
        role: UserRole.TENANT_ADMIN,
      });
      // Must not expose sensitive auth fields
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('throws NotFoundException when user is not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getMe('ghost-uuid')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for inactive users (query filters isActive: true)', async () => {
      // The query includes { isActive: true }, so inactive users return null from findFirst.
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getMe(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted users (query filters deletedAt: null)', async () => {
      // The query includes { deletedAt: null }, so deleted users return null from findFirst.
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getMe(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('includes condominium details when present', async () => {
      prisma.user.findFirst.mockResolvedValue(
        activeUser({ condominium: { id: CONDOMINIUM_ID, slug: CONDOMINIUM_SLUG, name: 'Test Condo' } }),
      );

      const result = await service.getMe(USER_ID);

      expect(result.condominium).toMatchObject({
        id: CONDOMINIUM_ID,
        slug: CONDOMINIUM_SLUG,
      });
    });

    it('returns null condominium for ROOT users without an associated condominium', async () => {
      prisma.user.findFirst.mockResolvedValue(activeRootUser({ condominium: null }));

      const result = await service.getMe(USER_ID);

      expect(result.condominium).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('forgotPassword', () => {
    it('returns the same generic message when no user is found (anti-enumeration)', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.forgotPassword({ email: 'ghost@test.local' });

      expect(result.message).toMatch(/if an account/i);
    });

    it('returns the same generic message when a user is found', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);

      const result = await service.forgotPassword({ email: 'user@test.local' });

      expect(result.message).toMatch(/if an account/i);
    });

    it('creates a PasswordResetToken for each matched user', async () => {
      const user1 = activeUser({ id: 'user-1', condominiumId: 'cond-1' });
      const user2 = { ...activeUser(), id: 'user-2', condominiumId: 'cond-2' };
      prisma.user.findMany.mockResolvedValue([user1, user2]);

      await service.forgotPassword({ email: 'user@test.local' });

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(2);
    });

    it('stores a SHA-256 hash — not the raw token', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);

      await service.forgotPassword({ email: 'user@test.local' });

      const callArg = prisma.passwordResetToken.create.mock.calls[0][0];
      const tokenHash: string = callArg.data.tokenHash;
      // SHA-256 hex digest is always 64 characters
      expect(tokenHash).toHaveLength(64);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('calls emailService.sendPasswordResetEmail once per matched user', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);

      await service.forgotPassword({ email: 'user@test.local' });

      expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(email.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@test.local',
        expect.any(String),
      );
    });

    it('does not call emailService when no users are found', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.forgotPassword({ email: 'ghost@test.local' });

      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not block the response when audit write throws', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);
      audit.log.mockRejectedValue(new Error('Audit DB unavailable'));

      await expect(
        service.forgotPassword({ email: 'user@test.local' }),
      ).resolves.toMatchObject({ message: expect.any(String) });
    });

    it('does not block the response when email service throws', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);
      email.sendPasswordResetEmail.mockRejectedValue(new Error('Resend API down'));

      await expect(
        service.forgotPassword({ email: 'user@test.local' }),
      ).resolves.toMatchObject({ message: expect.any(String) });
    });

    it('writes PASSWORD_RESET_REQUESTED audit for each matched user', async () => {
      prisma.user.findMany.mockResolvedValue([activeUser()]);

      await service.forgotPassword({ email: 'user@test.local' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PASSWORD_RESET_REQUESTED',
          result: 'SUCCESS',
          userId: USER_ID,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('resetPassword', () => {
    function validResetToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'reset-token-uuid-1',
        userId: USER_ID,
        tokenHash: expect.any(String),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        usedAt: null,
        user: activeUser(),
        ...overrides,
      };
    }

    beforeEach(() => {
      // Default bcrypt.hash mock for new password hashing
      (bcrypt.hash as jest.Mock) = jest.fn().mockResolvedValue('new-hashed-password');
    });

    it('returns a success message when token is valid', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validResetToken());

      const result = await service.resetPassword({
        token: 'valid-raw-token',
        newPassword: 'NewPass1234!',
      });

      expect(result.message).toMatch(/password reset/i);
    });

    it('throws BadRequestException when token is not found', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'bad-token', newPassword: 'NewPass1234!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when token is already used', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        validResetToken({ usedAt: new Date('2026-05-18T00:00:00Z') }),
      );

      await expect(
        service.resetPassword({ token: 'used-token', newPassword: 'NewPass1234!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when token is expired', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        validResetToken({ expiresAt: new Date('2026-01-01T00:00:00Z') }),
      );

      await expect(
        service.resetPassword({ token: 'expired-token', newPassword: 'NewPass1234!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user is inactive', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        validResetToken({ user: activeUser({ isActive: false }) }),
      );

      await expect(
        service.resetPassword({ token: 'valid-token', newPassword: 'NewPass1234!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('executes update, token mark-as-used, and refresh revocation in a transaction', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validResetToken());

      await service.resetPassword({ token: 'valid-raw-token', newPassword: 'NewPass1234!' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(3);
    });

    it('writes PASSWORD_RESET_COMPLETED audit on success', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validResetToken());

      await service.resetPassword({ token: 'valid-raw-token', newPassword: 'NewPass1234!' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PASSWORD_RESET_COMPLETED',
          result: 'SUCCESS',
          userId: USER_ID,
        }),
      );
    });

    it('does not block the reset when audit write throws', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validResetToken());
      audit.log.mockRejectedValue(new Error('Audit DB unavailable'));

      await expect(
        service.resetPassword({ token: 'valid-raw-token', newPassword: 'NewPass1234!' }),
      ).resolves.toMatchObject({ message: expect.any(String) });
    });
  });
});
