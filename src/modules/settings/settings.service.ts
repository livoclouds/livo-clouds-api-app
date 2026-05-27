import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateFeesSettingsDto } from './dto/update-fees-settings.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateTerraceSettingsDto } from './dto/update-terrace-settings.dto';

export interface LogoUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const LOGO_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_PRESIGN_TTL_SECONDS = 3600;
const LOGO_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

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
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
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
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

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

  async uploadLogo(condominiumId: string, file: LogoUploadFile, userId: string) {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException({
        code: 'LOGO_FILE_REQUIRED',
        reason: 'A single image file is required',
      });
    }

    if (!LOGO_ALLOWED_MIME.includes(file.mimetype as (typeof LOGO_ALLOWED_MIME)[number])) {
      throw new UnsupportedMediaTypeException({
        code: 'LOGO_INVALID_TYPE',
        reason: 'Only PNG, JPEG, or WebP images are accepted',
      });
    }

    if (file.size > LOGO_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'LOGO_TOO_LARGE',
        reason: 'Logo must be 2 MB or smaller',
      });
    }

    if (!matchesDeclaredMime(file.buffer, file.mimetype)) {
      throw new BadRequestException({
        code: 'LOGO_MAGIC_BYTE_MISMATCH',
        reason: 'File contents do not match the declared image type',
      });
    }

    if (!this.storageService.isConfigured()) {
      throw new BadRequestException({
        code: 'STORAGE_NOT_CONFIGURED',
        reason: 'Object storage is not configured on this environment',
      });
    }

    // Fetch the current logoUrl for best-effort cleanup after replacement.
    const existing = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      select: { logoUrl: true },
    });

    const ext = LOGO_MIME_TO_EXT[file.mimetype] ?? 'bin';
    const key = `condominiums/${condominiumId}/settings/logo-${Date.now()}.${ext}`;

    await this.storageService.uploadFile(key, file.buffer, file.mimetype, {
      condominiumId,
      byteSize: file.size,
    });

    // Resolve the uploader's display name for the audit trail.
    const uploader = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const logoUpdatedByName = uploader
      ? `${uploader.firstName} ${uploader.lastName}`.trim()
      : null;

    await this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, logoUrl: key, logoUpdatedAt: new Date(), logoUpdatedByName },
      update: { logoUrl: key, logoUpdatedAt: new Date(), logoUpdatedByName },
    });

    // Best-effort cleanup of the prior R2 object — never blocks the response.
    const previousKey = existing?.logoUrl ?? null;
    if (previousKey && !this.isAbsoluteUrl(previousKey) && previousKey !== key) {
      this.storageService
        .deleteFile(previousKey, { condominiumId })
        .catch((err) => {
          this.logger.warn(
            `[logo] failed to delete previous object ${previousKey}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    const logoUrl = await this.storageService.getPresignedUrl(
      key,
      LOGO_PRESIGN_TTL_SECONDS,
      { condominiumId },
    );

    return { logoUrl, logoUpdatedAt: new Date().toISOString(), logoUpdatedByName };
  }

  async deleteLogo(condominiumId: string) {
    const settings = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      select: { logoUrl: true },
    });

    if (!settings?.logoUrl) {
      return { logoUrl: null };
    }

    if (!this.isAbsoluteUrl(settings.logoUrl) && this.storageService.isConfigured()) {
      try {
        await this.storageService.deleteFile(settings.logoUrl, { condominiumId });
      } catch (err) {
        this.logger.warn(
          `[logo] failed to delete object ${settings.logoUrl}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.prisma.condominiumSettings.update({
      where: { condominiumId },
      data: { logoUrl: null, logoUpdatedAt: null, logoUpdatedByName: null },
    });

    return { logoUrl: null, logoUpdatedAt: null, logoUpdatedByName: null };
  }

  private isAbsoluteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }
}
