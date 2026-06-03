import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipInactivityLock } from '../../common/decorators/skip-inactivity-lock.decorator';
import { JwtPayload } from '../../common/types';
import { AuthService, AvatarUploadFile } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UnlockDto } from './dto/unlock.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { UpdateUiPreferencesDto } from './dto/update-ui-preferences.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  login(
    @Body() dto: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.login(dto, { ipAddress, userAgent, requestId });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.refresh(dto.refreshToken, { ipAddress, userAgent, requestId });
  }

  @Post('logout')
  @SkipInactivityLock()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke refresh token' })
  logout(
    @Body() dto: RefreshTokenDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.logout(dto.refreshToken, { ipAddress, userAgent, requestId });
  }

  @Post('unlock')
  @SkipInactivityLock()
  @HttpCode(HttpStatus.OK)
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Lift the in-app screen lock by re-verifying the password' })
  unlock(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UnlockDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.unlock(user.sub, user.sid, dto.password, {
      ipAddress,
      userAgent,
      requestId,
    });
  }

  @Post('lock')
  @SkipInactivityLock()
  @HttpCode(HttpStatus.OK)
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Persist the in-app screen lock for the current session' })
  lock(
    @CurrentUser() user: JwtPayload,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.lock(user.sid, { ipAddress, userAgent, requestId });
  }

  @Post('heartbeat')
  @SkipInactivityLock()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh session activity to defer the inactivity lock' })
  heartbeat(@CurrentUser() user: JwtPayload) {
    return this.authService.heartbeat(user.sid);
  }

  @Get('session-state')
  @SkipInactivityLock()
  @ApiOperation({ summary: 'Read the current session inactivity-lock status' })
  sessionState(@CurrentUser() user: JwtPayload) {
    return this.authService.getSessionState(user.sid);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ burst: { limit: 3, ttl: 60_000 }, sustained: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Request a password reset email' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.forgotPassword(dto, { ipAddress, userAgent, requestId });
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ burst: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password using a valid reset token' })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.authService.resetPassword(dto, { ipAddress, userAgent, requestId });
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @Get('me/onboarding')
  @ApiOperation({ summary: 'Get current user dashboard onboarding tour state' })
  getOnboarding(@CurrentUser() user: JwtPayload) {
    return this.authService.getOnboarding(user.sub);
  }

  @Patch('me/onboarding')
  @ApiOperation({ summary: 'Update current user dashboard onboarding tour state' })
  updateOnboarding(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOnboardingDto,
  ) {
    return this.authService.updateOnboarding(user.sub, dto);
  }

  @Get('me/ui-preferences')
  @ApiOperation({ summary: 'Get current user UI preferences (locale, theme, color)' })
  getUiPreferences(@CurrentUser() user: JwtPayload) {
    return this.authService.getUiPreferences(user.sub);
  }

  @Patch('me/ui-preferences')
  @ApiOperation({ summary: 'Update current user UI preferences (locale, theme, color)' })
  updateUiPreferences(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateUiPreferencesDto,
  ) {
    return this.authService.updateUiPreferences(user.sub, dto);
  }

  @Post('me/avatar')
  @Throttle({ burst: { limit: 3, ttl: 10_000 }, sustained: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload current user profile photo (max 2 MB)' })
  async uploadAvatar(
    @Request() req: FastifyRequest,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!req.isMultipart()) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        reason: 'Request must be multipart/form-data',
      });
    }

    let picked: AvatarUploadFile | null = null;
    let extraFiles = 0;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        if (picked) {
          // Drain extra files so the stream completes cleanly.
          extraFiles += 1;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _chunk of part.file) {
            // discard
          }
          continue;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk as Buffer);
        }
        const buffer = Buffer.concat(chunks);
        picked = {
          buffer,
          originalname: part.filename ?? 'avatar',
          mimetype: part.mimetype,
          size: buffer.length,
        };
      }
    }

    if (extraFiles > 0) {
      throw new BadRequestException({
        code: 'AVATAR_SINGLE_FILE_ONLY',
        reason: 'Only one image file may be uploaded per request',
      });
    }

    if (!picked) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        reason: 'A single image file is required',
      });
    }

    return this.authService.uploadAvatar(user.sub, picked);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Remove current user profile photo' })
  deleteAvatar(@CurrentUser() user: JwtPayload) {
    return this.authService.deleteAvatar(user.sub);
  }
}
