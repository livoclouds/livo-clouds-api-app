import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateTerraceSettingsDto } from './dto/update-terrace-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async findOne(condominiumId: string) {
    const settings = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      include: {
        condominium: { select: { name: true, primaryColor: true, slug: true } },
      },
    });

    if (!settings) {
      throw new NotFoundException('Settings not found for this condominium');
    }

    const { condominium, ...rest } = settings;
    return { ...rest, name: condominium.name, primaryColor: condominium.primaryColor, slug: condominium.slug };
  }

  async updateProfile(condominiumId: string, dto: UpdateProfileDto) {
    return this.prisma.condominium.update({
      where: { id: condominiumId },
      data: dto,
      select: { name: true, primaryColor: true, slug: true },
    });
  }

  async updateGeneral(condominiumId: string, dto: UpdateGeneralSettingsDto) {
    return this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
  }

  async updateFees(condominiumId: string, dto: UpdateFeesSettingsDto) {
    return this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
  }

  async updateFinancial(
    condominiumId: string,
    dto: { maxFilesPerImport?: number; allowedFilePdf?: boolean; allowedFileExcel?: boolean },
  ) {
    return this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
  }

  async validateFeesConfigured(
    condominiumId: string,
  ): Promise<{ valid: boolean; missingFields: string[] }> {
    const s = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      select: { totalUnits: true, ordinaryFeeAmount: true },
    });
    const missing: string[] = [];
    if (!s || s.totalUnits <= 0) missing.push('totalUnits');
    if (!s || Number(s.ordinaryFeeAmount) <= 0) missing.push('ordinaryFeeAmount');
    return { valid: missing.length === 0, missingFields: missing };
  }

  async updateTerrace(condominiumId: string, dto: UpdateTerraceSettingsDto) {
    return this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
  }

  async updateNotifications(
    condominiumId: string,
    dto: {
      notifyNegativeBalance?: boolean;
      notifyNewFileImported?: boolean;
      notifyImportError?: boolean;
      notifyNewUser?: boolean;
      notifyNewIncident?: boolean;
    },
  ) {
    return this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
  }
}
