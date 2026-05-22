import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateTerraceSettingsDto } from './dto/update-terrace-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@Controller('condominiums/:condominiumSlug/settings')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get condominium settings' })
  findOne(@Request() req: { condominiumId: string }) {
    return this.settingsService.findOne(req.condominiumId);
  }

  @Patch('profile')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update condominium name and brand color' })
  updateProfile(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.settingsService.updateProfile(req.condominiumId, dto);
  }

  @Patch('general')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update general settings' })
  updateGeneral(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateGeneralSettingsDto,
  ) {
    return this.settingsService.updateGeneral(req.condominiumId, dto);
  }

  @Patch('fees')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update fees settings' })
  updateFees(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateFeesSettingsDto,
  ) {
    return this.settingsService.updateFees(req.condominiumId, dto);
  }

  @Patch('financial')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update financial/import settings' })
  updateFinancial(
    @Request() req: { condominiumId: string },
    @Body() dto: { maxFilesPerImport?: number; allowedFilePdf?: boolean; allowedFileExcel?: boolean },
  ) {
    return this.settingsService.updateFinancial(req.condominiumId, dto);
  }

  @Patch('terrace')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
}
