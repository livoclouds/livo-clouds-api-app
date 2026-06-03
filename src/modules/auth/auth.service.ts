import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { JwtPayload, OnboardingStatus, UserRole } from '../../common/types';
import { resolveEffectivePermissions } from '../../common/rbac/permission-catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { StorageService } from '../storage/storage.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';

interface AuthContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AvatarUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// Wrong screen-unlock passwords tolerated before the session is force-revoked.
const MAX_UNLOCK_ATTEMPTS = 5;

const AVATAR_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_PRESIGN_TTL_SECONDS = 3600;
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// Magic-byte signatures — defense in depth, mirrors the imports pipeline.
function isPngBytes(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isJpegBytes(buf: Buffer): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

function isWebpBytes(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function matchesDeclaredMime(buf: Buffer, mime: string): boolean {
  if (mime === 'image/png') return isPngBytes(buf);
  if (mime === 'image/jpeg') return isJpegBytes(buf);
  if (mime === 'image/webp') return isWebpBytes(buf);
  return false;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Computed once at service startup to flatten response timing when a user is not found.
  // bcrypt.compare against this hash always fails but takes the same time as a real comparison,
  // preventing timing-based email enumeration (LOG-016).
  private readonly DUMMY_HASH = bcrypt.hashSync('livo-dummy-hash-placeholder', 12);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
    private emailService: EmailService,
    private storageService: StorageService,
  ) {}

  async login(dto: LoginDto, ctx?: AuthContext) {
    const startMs = Date.now();

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      include: {
        condominium: { select: { slug: true } },
        roleRef: { select: { key: true, name: true, permissions: true } },
      },
    });

    if (!user) {
      // Run dummy comparison to match timing of the wrong-password path (LOG-016).
      // Cannot write audit log: userId unknown for non-existent email.
      await bcrypt.compare(dto.password, this.DUMMY_HASH);
      this.logger.warn(JSON.stringify({
        event: 'auth.login.failed',
        reason: 'INVALID_CREDENTIALS',
        requestId: ctx?.requestId,
        latencyMs: Date.now() - startMs,
        ip: ctx?.ipAddress,
      }));
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check account status before bcrypt to avoid unnecessary computation (LOG-008).
    // Returns the same generic error as wrong-password to prevent account enumeration.
    if (!user.isActive) {
      try {
        await this.auditService.log({
          userId: user.id,
          condominiumId: user.condominiumId ?? undefined,
          action: 'AUTH_LOGIN_FAILED',
          actionCategory: 'AUTH',
          module: 'auth',
          result: 'WARNING',
          description: 'Login failed: account inactive',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
        });
      } catch {
        // Audit failure must not block authentication
      }
      this.logger.warn(JSON.stringify({
        event: 'auth.login.failed',
        reason: 'ACCOUNT_INACTIVE',
        userId: user.id,
        requestId: ctx?.requestId,
        latencyMs: Date.now() - startMs,
        ip: ctx?.ipAddress,
      }));
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      try {
        await this.auditService.log({
          userId: user.id,
          condominiumId: user.condominiumId ?? undefined,
          action: 'AUTH_LOGIN_FAILED',
          actionCategory: 'AUTH',
          module: 'auth',
          result: 'ERROR',
          description: 'Login failed: invalid password',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
        });
      } catch {
        // Audit failure must not block authentication
      }
      this.logger.warn(JSON.stringify({
        event: 'auth.login.failed',
        reason: 'INVALID_PASSWORD',
        userId: user.id,
        requestId: ctx?.requestId,
        latencyMs: Date.now() - startMs,
        ip: ctx?.ipAddress,
      }));
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: (user.roleRef?.key as UserRole) ?? UserRole.READ_ONLY,
      condominiumId: user.condominiumId,
      condominiumSlug: user.condominium?.slug ?? null,
    };

    // Generate tokens first; only advance lastLoginAt if this succeeds (LOG-013).
    const { accessToken, refreshToken } = await this.generateTokens(payload);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    try {
      await this.auditService.log({
        userId: user.id,
        condominiumId: user.condominiumId ?? undefined,
        action: 'AUTH_LOGIN_SUCCESS',
        actionCategory: 'AUTH',
        module: 'auth',
        result: 'SUCCESS',
        description: 'User logged in successfully',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });
    } catch {
      // Audit failure must not block authentication
    }

    this.logger.log(JSON.stringify({
      event: 'auth.login.success',
      userId: user.id,
      condominiumId: user.condominiumId,
      requestId: ctx?.requestId,
      latencyMs: Date.now() - startMs,
      ip: ctx?.ipAddress,
    }));

    return {
      accessToken,
      refreshToken,
      sessionDuration: user.sessionDuration,
      inactivityLockMinutes: user.inactivityLockMinutes,
      // Dynamic RBAC: effective permissions + the assigned role's stable key and
      // display name. Drives the web UI (RequirePermission). The API still
      // enforces authorisation independently. roleKey falls back to the legacy
      // enum while roleId is being backfilled.
      roleKey: user.roleRef?.key ?? null,
      roleName: user.roleRef?.name ?? null,
      permissions: resolveEffectivePermissions(user.roleRef, {
        overrides: user.permissionOverrides as string[] | null,
      }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.roleRef?.key ?? null,
        condominiumId: user.condominiumId,
        condominiumSlug: user.condominium?.slug ?? null,
        avatarUrl: await this.resolveAvatarUrl(
          user.avatarUrl,
          user.id,
          user.condominiumId,
        ),
      },
    };
  }

  async refresh(token: string, ctx?: AuthContext) {
    const startMs = Date.now();

    // Fetch without revokedAt filter so we can distinguish reuse from never-issued (LOG-011).
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token },
      include: {
        user: {
          include: {
            condominium: { select: { slug: true } },
            roleRef: { select: { key: true, name: true, permissions: true } },
          },
        },
      },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    // Reuse detection: token exists but was already rotated — potential token theft (LOG-011).
    if (stored.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      try {
        await this.auditService.log({
          userId: stored.userId,
          condominiumId: stored.user?.condominiumId ?? undefined,
          action: 'AUTH_REFRESH_REUSE_DETECTED',
          actionCategory: 'AUTH',
          module: 'auth',
          result: 'ERROR',
          description: 'Refresh token reuse detected; all active tokens revoked',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
        });
      } catch {
        // Audit failure must not block security response
      }
      this.logger.error(JSON.stringify({
        event: 'auth.refresh.reuse_detected',
        userId: stored.userId,
        requestId: ctx?.requestId,
        ip: ctx?.ipAddress,
      }));
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = stored.user;

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: (user.roleRef?.key as UserRole) ?? UserRole.READ_ONLY,
      condominiumId: user.condominiumId,
      condominiumSlug: user.condominium?.slug ?? null,
    };

    // Carry the inactivity lock across rotation: a session that was explicitly
    // locked, or had been idle past the user's threshold, hands that lock to the
    // new session. This closes the bypass where simply letting the access token
    // expire (and auto-refresh) would otherwise mint a fresh, unlocked session.
    const idleMs = stored.lastActivityAt
      ? Date.now() - stored.lastActivityAt.getTime()
      : 0;
    const wasLocked =
      stored.lockedAt !== null ||
      (stored.lastActivityAt !== null &&
        idleMs > user.inactivityLockMinutes * 60_000);

    const { accessToken, refreshToken } = await this.generateTokens(
      payload,
      wasLocked
        ? {
            lockedAt: stored.lockedAt ?? new Date(),
            lastActivityAt: stored.lastActivityAt,
          }
        : undefined,
    );

    try {
      await this.auditService.log({
        userId: user.id,
        condominiumId: user.condominiumId ?? undefined,
        action: 'AUTH_REFRESH',
        actionCategory: 'AUTH',
        module: 'auth',
        result: 'SUCCESS',
        description: 'Session token refreshed',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });
    } catch {
      // Audit failure must not block token refresh
    }

    this.logger.log(JSON.stringify({
      event: 'auth.refresh.success',
      userId: user.id,
      requestId: ctx?.requestId,
      latencyMs: Date.now() - startMs,
      ip: ctx?.ipAddress,
    }));

    return {
      accessToken,
      refreshToken,
      sessionDuration: user.sessionDuration,
      inactivityLockMinutes: user.inactivityLockMinutes,
      // Re-issue RBAC context on rotation so permission/role changes take effect
      // on the next refresh without forcing a full re-login.
      roleKey: user.roleRef?.key ?? null,
      roleName: user.roleRef?.name ?? null,
      permissions: resolveEffectivePermissions(user.roleRef, {
        overrides: user.permissionOverrides as string[] | null,
      }),
    };
  }

  async logout(token: string, ctx?: AuthContext) {
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token, revokedAt: null },
      select: { userId: true, user: { select: { condominiumId: true } } },
    });

    await this.prisma.refreshToken.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (stored) {
      try {
        await this.auditService.log({
          userId: stored.userId,
          condominiumId: stored.user?.condominiumId ?? undefined,
          action: 'AUTH_LOGOUT',
          actionCategory: 'AUTH',
          module: 'auth',
          result: 'SUCCESS',
          description: 'User logged out',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
        });
      } catch {
        // Audit failure must not block logout
      }
      this.logger.log(JSON.stringify({
        event: 'auth.logout.success',
        userId: stored.userId,
        requestId: ctx?.requestId,
        ip: ctx?.ipAddress,
      }));
    } else {
      this.logger.warn(JSON.stringify({
        event: 'auth.logout.noop',
        reason: 'TOKEN_NOT_FOUND_OR_REVOKED',
        requestId: ctx?.requestId,
        ip: ctx?.ipAddress,
      }));
    }
  }

  /**
   * Lift the in-app screen lock by re-verifying the user's password. On success
   * the session lock is cleared and activity is refreshed. Wrong passwords
   * accrue on the session; after MAX_UNLOCK_ATTEMPTS the session is revoked so
   * the client is forced back to the login screen.
   */
  async unlock(
    userId: string,
    sid: string | undefined,
    password: string,
    ctx?: AuthContext,
  ): Promise<{ unlocked: boolean; attemptsLeft?: number; loggedOut?: boolean }> {
    if (!sid) {
      // Access token minted before this feature shipped — nothing to unlock.
      throw new UnauthorizedException('Session context missing');
    }

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sid },
      select: {
        revokedAt: true,
        failedUnlockAttempts: true,
        user: {
          select: {
            id: true,
            passwordHash: true,
            condominiumId: true,
            isActive: true,
          },
        },
      },
    });

    // Session gone, mismatched, or the account was disabled — force a logout.
    if (
      !session ||
      session.revokedAt ||
      session.user.id !== userId ||
      !session.user.isActive
    ) {
      return { unlocked: false, loggedOut: true };
    }

    const passwordValid = await bcrypt.compare(
      password,
      session.user.passwordHash,
    );

    if (passwordValid) {
      await this.prisma.refreshToken.update({
        where: { id: sid },
        data: {
          lockedAt: null,
          lastActivityAt: new Date(),
          failedUnlockAttempts: 0,
        },
      });
      await this.safeAudit({
        userId,
        condominiumId: session.user.condominiumId ?? undefined,
        action: 'AUTH_SESSION_UNLOCK',
        result: 'SUCCESS',
        description: 'Screen lock lifted via password re-verification',
        ctx,
      });
      return { unlocked: true };
    }

    const attempts = session.failedUnlockAttempts + 1;

    if (attempts >= MAX_UNLOCK_ATTEMPTS) {
      await this.prisma.refreshToken.update({
        where: { id: sid },
        data: { revokedAt: new Date(), failedUnlockAttempts: attempts },
      });
      await this.safeAudit({
        userId,
        condominiumId: session.user.condominiumId ?? undefined,
        action: 'AUTH_SESSION_UNLOCK_LOCKOUT',
        result: 'ERROR',
        description: `Screen unlock failed ${attempts} times; session revoked`,
        ctx,
      });
      return { unlocked: false, loggedOut: true };
    }

    await this.prisma.refreshToken.update({
      where: { id: sid },
      data: { failedUnlockAttempts: attempts },
    });
    await this.safeAudit({
      userId,
      condominiumId: session.user.condominiumId ?? undefined,
      action: 'AUTH_SESSION_UNLOCK_FAILED',
      result: 'WARNING',
      description: `Screen unlock failed (attempt ${attempts}/${MAX_UNLOCK_ATTEMPTS})`,
      ctx,
    });
    return { unlocked: false, attemptsLeft: MAX_UNLOCK_ATTEMPTS - attempts };
  }

  /**
   * Persist the in-app screen lock for the current session. The web client calls
   * this the moment its lock engages (idle timer, a 423, or any client-side
   * lock), so the lock survives a page reload and token rotation instead of
   * living only in client memory. Without it, `lastActivityAt` stays recent and
   * a reload reports `locked:false`, letting the user back into the dashboard.
   * Idempotent: a no-op when the session is already locked, revoked, or missing.
   */
  async lock(
    sid: string | undefined,
    ctx?: AuthContext,
  ): Promise<{ locked: boolean }> {
    if (!sid) return { locked: false };

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sid },
      select: {
        lockedAt: true,
        revokedAt: true,
        userId: true,
        user: { select: { condominiumId: true } },
      },
    });

    if (!session || session.revokedAt) return { locked: false };
    if (session.lockedAt) return { locked: true };

    await this.prisma.refreshToken.update({
      where: { id: sid },
      data: { lockedAt: new Date() },
    });
    await this.safeAudit({
      userId: session.userId,
      condominiumId: session.user.condominiumId ?? undefined,
      action: 'AUTH_SESSION_LOCK',
      result: 'SUCCESS',
      description: 'Screen lock engaged by client (inactivity or manual)',
      ctx,
    });
    return { locked: true };
  }

  /**
   * Refresh the session's activity timestamp. Driven by genuine user
   * interaction (the client throttles it), so background polling never keeps a
   * session alive. A locked session is not refreshed — it must be unlocked.
   */
  async heartbeat(sid: string | undefined): Promise<{ locked: boolean }> {
    if (!sid) return { locked: false };

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sid },
      select: { lockedAt: true, revokedAt: true },
    });

    if (!session || session.revokedAt) return { locked: false };
    if (session.lockedAt) return { locked: true };

    await this.prisma.refreshToken.update({
      where: { id: sid },
      data: { lastActivityAt: new Date() },
    });
    return { locked: false };
  }

  /**
   * Read-only lock status for the current session. Lets the client render the
   * lock overlay instantly on load (e.g. after a page refresh) without waiting
   * for a data request to bounce off the guard with a 423.
   */
  async getSessionState(sid: string | undefined): Promise<{ locked: boolean }> {
    if (!sid) return { locked: false };

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sid },
      select: {
        lastActivityAt: true,
        lockedAt: true,
        revokedAt: true,
        user: { select: { inactivityLockMinutes: true } },
      },
    });

    if (!session || session.revokedAt) return { locked: false };
    if (session.lockedAt) return { locked: true };

    const last = session.lastActivityAt;
    const minutes = session.user.inactivityLockMinutes;
    const locked = !!last && Date.now() - last.getTime() > minutes * 60_000;
    return { locked };
  }

  // DRY wrapper around audit logging; a failure here must never break an auth flow.
  private async safeAudit(args: {
    userId: string;
    condominiumId?: string;
    action: string;
    result: 'SUCCESS' | 'WARNING' | 'ERROR';
    description: string;
    ctx?: AuthContext;
  }): Promise<void> {
    try {
      await this.auditService.log({
        userId: args.userId,
        condominiumId: args.condominiumId,
        action: args.action,
        actionCategory: 'AUTH',
        module: 'auth',
        result: args.result,
        description: args.description,
        ipAddress: args.ctx?.ipAddress,
        userAgent: args.ctx?.userAgent,
      });
    } catch {
      // Audit failure must not block authentication flows
    }
  }

  async forgotPassword(dto: ForgotPasswordDto, ctx?: AuthContext) {
    const startMs = Date.now();

    // A given email can exist in multiple condominiums (composite unique on [condominiumId, email]).
    // Send one reset email per matched account so every account can be reset independently.
    const users = await this.prisma.user.findMany({
      where: { email: dto.email, isActive: true, deletedAt: null },
    });

    for (const user of users) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60_000);

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      // Fire-and-forget — email failure must not expose user existence or block response.
      this.emailService.sendPasswordResetEmail(dto.email, rawToken).catch(() => undefined);

      try {
        await this.auditService.log({
          userId: user.id,
          condominiumId: user.condominiumId ?? undefined,
          action: 'PASSWORD_RESET_REQUESTED',
          actionCategory: 'AUTH',
          module: 'auth',
          result: 'SUCCESS',
          description: 'Password reset requested',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
        });
      } catch {
        // Audit failure must not block the reset flow
      }
    }

    this.logger.log(JSON.stringify({
      event: 'auth.forgot_password.requested',
      matchCount: users.length,
      requestId: ctx?.requestId,
      latencyMs: Date.now() - startMs,
      ip: ctx?.ipAddress,
    }));

    // Always return the same message regardless of match count — prevents email enumeration.
    return { message: 'If an account with that email exists, a reset link has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto, ctx?: AuthContext) {
    const startMs = Date.now();

    const tokenHash = createHash('sha256').update(dto.token).digest('hex');

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      throw new BadRequestException('INVALID_RESET_TOKEN');
    }

    if (record.usedAt !== null) {
      throw new BadRequestException('RESET_TOKEN_ALREADY_USED');
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException('RESET_TOKEN_EXPIRED');
    }

    if (!record.user.isActive || record.user.deletedAt !== null) {
      throw new BadRequestException('INVALID_RESET_TOKEN');
    }

    // Salt rounds match UsersService.SALT_ROUNDS (12).
    const newHash = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    try {
      await this.auditService.log({
        userId: record.userId,
        condominiumId: record.user.condominiumId ?? undefined,
        action: 'PASSWORD_RESET_COMPLETED',
        actionCategory: 'AUTH',
        module: 'auth',
        result: 'SUCCESS',
        description: 'Password reset completed; all active sessions revoked',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });
    } catch {
      // Audit failure must not block the reset completion
    }

    this.logger.log(JSON.stringify({
      event: 'auth.reset_password.completed',
      userId: record.userId,
      requestId: ctx?.requestId,
      latencyMs: Date.now() - startMs,
      ip: ctx?.ipAddress,
    }));

    return { message: 'Password reset successfully' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      include: {
        condominium: {
          select: {
            id: true,
            slug: true,
            name: true,
            settings: { select: { logoUrl: true } },
          },
        },
        roleRef: { select: { key: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rawLogoKey =
      user.condominium?.settings?.logoUrl ?? null;
    const condominiumLogoUrl = rawLogoKey
      ? await this.resolveLogoUrl(rawLogoKey, user.condominiumId)
      : null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.roleRef?.key ?? null,
      avatarUrl: await this.resolveAvatarUrl(
        user.avatarUrl,
        user.id,
        user.condominiumId,
      ),
      phone: user.phone,
      condominium: user.condominium
        ? {
            id: user.condominium.id,
            slug: user.condominium.slug,
            name: user.condominium.name,
            logoUrl: condominiumLogoUrl,
          }
        : null,
    };
  }

  async uploadAvatar(userId: string, file: AvatarUploadFile) {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        reason: 'A single image file is required',
      });
    }

    if (!AVATAR_ALLOWED_MIME.includes(file.mimetype as (typeof AVATAR_ALLOWED_MIME)[number])) {
      throw new UnsupportedMediaTypeException({
        code: 'AVATAR_INVALID_TYPE',
        reason: 'Only PNG, JPEG, or WebP images are accepted',
      });
    }

    if (file.size > AVATAR_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'AVATAR_TOO_LARGE',
        reason: 'Avatar must be 2 MB or smaller',
      });
    }

    if (!matchesDeclaredMime(file.buffer, file.mimetype)) {
      throw new BadRequestException({
        code: 'AVATAR_MAGIC_BYTE_MISMATCH',
        reason: 'File contents do not match the declared image type',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: {
        id: true,
        condominiumId: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!this.storageService.isConfigured()) {
      throw new BadRequestException({
        code: 'STORAGE_NOT_CONFIGURED',
        reason: 'Object storage is not configured on this environment',
      });
    }

    const extension = MIME_TO_EXTENSION[file.mimetype] ?? 'bin';
    const filename = `avatar-${Date.now()}.${extension}`;
    const key = user.condominiumId
      ? `condominiums/${user.condominiumId}/users/${user.id}/${filename}`
      : `platform/users/${user.id}/${filename}`;

    await this.storageService.uploadFile(key, file.buffer, file.mimetype, {
      userId: user.id,
      condominiumId: user.condominiumId,
      byteSize: file.size,
    });

    const previousKey = user.avatarUrl;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: key },
    });

    // Best-effort cleanup of the prior R2 object — never blocks the response.
    if (previousKey && !this.isAbsoluteUrl(previousKey) && previousKey !== key) {
      this.storageService
        .deleteFile(previousKey, {
          userId: user.id,
          condominiumId: user.condominiumId,
        })
        .catch((err) => {
          this.logger.warn(
            `[avatar] failed to delete previous object ${previousKey}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    const avatarUrl = await this.storageService.getPresignedUrl(
      key,
      AVATAR_PRESIGN_TTL_SECONDS,
      { userId: user.id, condominiumId: user.condominiumId },
    );

    return { avatarUrl };
  }

  async deleteAvatar(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { id: true, condominiumId: true, avatarUrl: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.avatarUrl) {
      return { avatarUrl: null };
    }

    if (!this.isAbsoluteUrl(user.avatarUrl) && this.storageService.isConfigured()) {
      try {
        await this.storageService.deleteFile(user.avatarUrl, {
          userId: user.id,
          condominiumId: user.condominiumId,
        });
      } catch (err) {
        this.logger.warn(
          `[avatar] failed to delete object ${user.avatarUrl}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });

    return { avatarUrl: null };
  }

  private isAbsoluteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  // The DB stores either an R2 object key or, for legacy seed data, an absolute
  // URL. Resolve to a fresh presigned URL when the value is a key, pass through
  // when it is already a URL, return null when nothing is set or storage is
  // unconfigured (so the UI falls back to initials).
  private async resolveAvatarUrl(
    value: string | null,
    userId: string,
    condominiumId: string | null,
  ): Promise<string | null> {
    if (!value) return null;
    if (this.isAbsoluteUrl(value)) return value;
    if (!this.storageService.isConfigured()) return null;
    try {
      return await this.storageService.getPresignedUrl(
        value,
        AVATAR_PRESIGN_TTL_SECONDS,
        { userId, condominiumId },
      );
    } catch (err) {
      this.logger.warn(
        `[avatar] failed to presign ${value}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // Resolve a condominium logo R2 key to a fresh presigned URL.
  // Mirrors resolveAvatarUrl but scoped to condominiumId only.
  private async resolveLogoUrl(
    value: string | null,
    condominiumId: string | null,
  ): Promise<string | null> {
    if (!value) return null;
    if (this.isAbsoluteUrl(value)) return value;
    if (!this.storageService.isConfigured()) return null;
    try {
      return await this.storageService.getPresignedUrl(
        value,
        AVATAR_PRESIGN_TTL_SECONDS,
        { condominiumId },
      );
    } catch (err) {
      this.logger.warn(
        `[logo] failed to presign ${value}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async getOnboarding(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: {
        onboardingStatus: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingSkippedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      status: user.onboardingStatus,
      step: user.onboardingStep,
      completedAt: user.onboardingCompletedAt,
      skippedAt: user.onboardingSkippedAt,
    };
  }

  async updateOnboarding(userId: string, dto: UpdateOnboardingDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const data: {
      onboardingStatus?: OnboardingStatus;
      onboardingStep?: number;
      onboardingCompletedAt?: Date;
      onboardingSkippedAt?: Date;
    } = {};

    if (dto.status !== undefined) {
      data.onboardingStatus = dto.status;
      // Seal the matching timestamp the first time the tour is finished or
      // skipped; replaying the tour later simply refreshes it.
      if (dto.status === OnboardingStatus.COMPLETED) {
        data.onboardingCompletedAt = new Date();
      } else if (dto.status === OnboardingStatus.SKIPPED) {
        data.onboardingSkippedAt = new Date();
      }
    }

    if (dto.step !== undefined) {
      data.onboardingStep = dto.step;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        onboardingStatus: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingSkippedAt: true,
      },
    });

    return {
      status: updated.onboardingStatus,
      step: updated.onboardingStep,
      completedAt: updated.onboardingCompletedAt,
      skippedAt: updated.onboardingSkippedAt,
    };
  }

  // Parses duration strings like '7d', '14d', '1h', '30m', '60s' into milliseconds.
  // Returns fallback when the format is not recognized.
  private parseDurationMs(duration: string, fallback: number): number {
    const match = /^(\d+)(s|m|h|d)$/.exec(duration);
    if (!match) return fallback;
    const value = parseInt(match[1], 10);
    const units: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * units[match[2]];
  }

  private async generateTokens(
    payload: JwtPayload,
    // Carries the inactivity-lock state onto the freshly minted session. On
    // login this is omitted (a brand-new, unlocked, active session). On refresh
    // it propagates the previous session's lock so a locked session can never be
    // silently cleared just by letting the access token expire and rotate.
    lockState?: { lockedAt: Date | null; lastActivityAt: Date | null },
  ) {
    // Pre-allocate the session id so the access token can carry it as `sid`,
    // tying every request back to this exact RefreshToken row for the
    // inactivity screen lock (see InactivityLockGuard).
    const sessionId = randomUUID();

    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
    const refreshExpiresIn = this.configService.get<string>(
      'jwt.refreshExpiresIn',
      '7d',
    );

    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn,
    });

    const accessToken = this.jwtService.sign({ ...payload, sid: sessionId });

    // Derive DB expiresAt from the configured refresh TTL so both stay in sync (LOG-010).
    const refreshDurationMs = this.parseDurationMs(refreshExpiresIn, 7 * 86_400_000);
    const expiresAt = new Date(Date.now() + refreshDurationMs);

    await this.prisma.refreshToken.create({
      data: {
        id: sessionId,
        userId: payload.sub,
        token: refreshToken,
        expiresAt,
        // Seed activity at creation so a brand-new session isn't treated as idle.
        // On refresh, inherit the prior session's lock/activity instead.
        lastActivityAt: lockState?.lastActivityAt ?? new Date(),
        lockedAt: lockState?.lockedAt ?? null,
      },
    });

    return { accessToken, refreshToken };
  }
}
