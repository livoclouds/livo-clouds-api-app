import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async findOne(condominiumId: string) {
    const settings = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
    });

    if (!settings) {
      throw new NotFoundException('Settings not found for this condominium');
    }

    return settings;
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
