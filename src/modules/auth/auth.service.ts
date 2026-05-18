import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { JwtPayload, UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';

interface AuthContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
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
        avatarUrl: user.avatarUrl,
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

  async getMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      include: { condominium: { select: { id: true, slug: true, name: true } } },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      condominium: user.condominium ?? null,
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
