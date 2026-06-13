import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RbacService } from '../../common/rbac/rbac.service';
import { JwtPayload } from '../../common/types';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateTerraceSettingsDto } from './dto/update-terrace-settings.dto';
import { LogoUploadFile, SettingsService } from './settings.service';

@ApiTags('Settings')
@Controller('condominiums/:condominiumSlug/settings')
@UseGuards(CondominiumAccessGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly rbac: RbacService,
  ) {}

  // CAL-053: GET /settings stays membership-accessible (the web app reads general /
  // branding / fee settings here app-wide), but the terrace pricing fields are
  // redacted for callers without settings.read / settings.update — so a RESIDENT or
  // GUARD can no longer read terrace pricing one endpoint over and bypass the
  // calendar module's own redactTerraceFinancials. Permissions resolve live per
  // request (the JWT carries only a stale role), mirroring CalendarController.
  @Get()
  @ApiOperation({ summary: 'Get condominium settings' })
  async findOne(
    @Request() req: { condominiumId: string; user: JwtPayload },
  ) {
    const perms = await this.rbac.getEffectivePermissions(req.user.sub);
    return this.settingsService.findOne(req.condominiumId, perms);
  }

  @Patch('profile')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Update condominium name and brand color' })
  updateProfile(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.settingsService.updateProfile(req.condominiumId, dto);
  }

  @Patch('general')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Update general settings' })
  updateGeneral(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateGeneralSettingsDto,
  ) {
    return this.settingsService.updateGeneral(req.condominiumId, dto);
  }

  @Patch('fees')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Update fees settings' })
  updateFees(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateFeesSettingsDto,
  ) {
    return this.settingsService.updateFees(req.condominiumId, dto);
  }

  @Patch('financial')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Update financial/import settings' })
  updateFinancial(
    @Request() req: { condominiumId: string },
    @Body() dto: { maxFilesPerImport?: number; allowedFilePdf?: boolean; allowedFileExcel?: boolean },
  ) {
    return this.settingsService.updateFinancial(req.condominiumId, dto);
  }

  @Patch('terrace')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Update terrace booking settings' })
  updateTerrace(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateTerraceSettingsDto,
  ) {
    return this.settingsService.updateTerrace(req.condominiumId, dto);
  }

  @Get('validate-fees')
  @ApiOperation({ summary: 'Check if minimum fees configuration is set' })
  validateFees(@Request() req: { condominiumId: string }) {
    return this.settingsService.validateFeesConfigured(req.condominiumId);
  }

  @Post('logo')
  @RequirePermission('settings.update')
  @Throttle({ burst: { limit: 3, ttl: 10_000 }, sustained: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload condominium logo (max 2 MB — PNG, JPEG, WebP)' })
  async uploadLogo(
    @Request() req: FastifyRequest & { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!req.isMultipart()) {
      throw new BadRequestException({
        code: 'LOGO_FILE_REQUIRED',
        reason: 'Request must be multipart/form-data',
      });
    }

    let picked: LogoUploadFile | null = null;
    let extraFiles = 0;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        if (picked) {
          extraFiles += 1;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _chunk of part.file) {
            // discard extra files to keep the stream clean
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
          originalname: part.filename ?? 'logo',
          mimetype: part.mimetype,
          size: buffer.length,
        };
      }
    }

    if (extraFiles > 0) {
      throw new BadRequestException({
        code: 'LOGO_SINGLE_FILE_ONLY',
        reason: 'Only one image file may be uploaded per request',
      });
    }

    if (!picked) {
      throw new BadRequestException({
        code: 'LOGO_FILE_REQUIRED',
        reason: 'A single image file is required',
      });
    }

    return this.settingsService.uploadLogo(req.condominiumId, picked, user.sub);
  }

  @Delete('logo')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Remove condominium logo' })
  deleteLogo(@Request() req: { condominiumId: string }) {
    return this.settingsService.deleteLogo(req.condominiumId);
  }
}
