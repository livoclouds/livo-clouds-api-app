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
import { createHash, randomBytes } from 'crypto';
import { JwtPayload, OnboardingStatus, UserRole } from '../../common/types';
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
      include: { condominium: { select: { slug: true } } },
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
      role: user.role as UserRole,
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
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
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
          include: { condominium: { select: { slug: true } } },
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
      role: user.role as UserRole,
      condominiumId: user.condominiumId,
      condominiumSlug: user.condominium?.slug ?? null,
    };

    const { accessToken, refreshToken } = await this.generateTokens(payload);

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

    return { accessToken, refreshToken, sessionDuration: user.sessionDuration };
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
      role: user.role,
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

  private async generateTokens(payload: JwtPayload) {
    const accessToken = this.jwtService.sign(payload);

    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
    const refreshExpiresIn = this.configService.get<string>(
      'jwt.refreshExpiresIn',
      '7d',
    );

    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn,
    });

    // Derive DB expiresAt from the configured refresh TTL so both stay in sync (LOG-010).
    const refreshDurationMs = this.parseDurationMs(refreshExpiresIn, 7 * 86_400_000);
    const expiresAt = new Date(Date.now() + refreshDurationMs);

    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        token: refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
