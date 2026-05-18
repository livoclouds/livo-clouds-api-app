import {
  HttpException,
  HttpStatus,
  Injectable,
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
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
  ) {}

  async login(dto: LoginDto, ctx?: AuthContext) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      include: { condominium: { select: { slug: true } } },
    });

    if (!user) {
      // Cannot write audit log: userId unknown for non-existent email.
      // Anonymous login-failure audit logging requires schema change (Phase 2).
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
      throw new UnauthorizedException('Invalid credentials');
    }

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
      throw new HttpException(
        { code: 'AUTH_ACCOUNT_INACTIVE', message: 'Account is inactive.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

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
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token, revokedAt: null },
      include: {
        user: {
          include: { condominium: { select: { slug: true } } },
        },
      },
    });

    if (!stored || stored.expiresAt < new Date()) {
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

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

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
