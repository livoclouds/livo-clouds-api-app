import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SettingsCacheService } from './settings-cache.service';
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

// CAL-053: terrace pricing config exposed by GET /settings. These are the same
// amounts the calendar module redacts on terrace events (redactTerraceFinancials);
// leaving them readable here let any condominium member bypass that redaction one
// endpoint over. Fee amounts (ordinary/extraordinary/late) are intentionally NOT
// redacted — residents legitimately need to see their own dues.
const REDACTED_SETTINGS_FINANCIAL_FIELDS = [
  'terraceRentalAmount',
  'terraceSecurityDepositAmount',
] as const;

/** A caller may read terrace pricing only with settings.read or settings.update. */
function canViewSettingsFinancials(perms?: ReadonlySet<string>): boolean {
  return perms ? perms.has('settings.read') || perms.has('settings.update') : false;
}

/**
 * Null out terrace pricing fields for callers without settings read/update.
 * Fail-closed: an absent permission set redacts (no real caller omits it).
 */
function redactSettingsFinancials<T extends Record<string, unknown>>(
  settings: T,
  perms?: ReadonlySet<string>,
): T {
  if (canViewSettingsFinancials(perms)) return settings;
  const safe: Record<string, unknown> = { ...settings };
  for (const field of REDACTED_SETTINGS_FINANCIAL_FIELDS) {
    if (field in safe) safe[field] = null;
  }
  return safe as T;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private settingsCache: SettingsCacheService,
  ) {}

  // CAL-053: `perms` is the caller's effective permission set (resolved live by the
  // controller). Terrace pricing is redacted unless it holds settings.read/update.
  async findOne(condominiumId: string, perms?: ReadonlySet<string>) {
    // Phase 6 (A5): served from the tenant-scoped TTL cache. The raw row is
    // cached; the presigned logo URL below is always signed fresh on read.
    const settings = await this.settingsCache.getSettings(condominiumId);

    if (!settings) {
      throw new NotFoundException('Settings not found for this condominium');
    }

    const { condominium, ...rest } = settings;

    // Sign the stored R2 key so GET /settings returns a usable presigned URL,
    // not a raw storage path that the <img> tag cannot load.
    let logoUrl: string | null = rest.logoUrl ?? null;
    if (logoUrl && !this.isAbsoluteUrl(logoUrl)) {
      logoUrl = await this.storageService.getPresignedUrl(
        logoUrl,
        LOGO_PRESIGN_TTL_SECONDS,
        { condominiumId },
      );
    }

    const body = { ...rest, logoUrl, name: condominium.name, primaryColor: condominium.primaryColor, slug: condominium.slug };
    return redactSettingsFinancials(body, perms);
  }

  async updateProfile(condominiumId: string, dto: UpdateProfileDto) {
    // updateProfile writes the `condominium` row that findOne returns
    // (name/primaryColor/slug), so the cached settings entry must be dropped.
    const result = await this.prisma.condominium.update({
      where: { id: condominiumId },
      data: dto,
      select: { name: true, primaryColor: true, slug: true },
    });
    this.settingsCache.invalidate(condominiumId);
    return result;
  }

  async updateGeneral(condominiumId: string, dto: UpdateGeneralSettingsDto) {
    // Score weights (Fase 4) are relative importances auto-normalized to 100 — the
    // DTO bounds each to 0–100; reject only an all-zero set (would divide by zero).
    // Score weights (Fase 4): the DTO is a class instance — pull it out and re-add
    // as a plain JSON object so it satisfies Prisma's Json input type. Reject only
    // an all-zero set (would divide by zero when auto-normalizing to 100).
    const { financialHealthWeights, ...rest } = dto;
    if (financialHealthWeights) {
      const sum = Object.values(financialHealthWeights).reduce(
        (a, b) => a + Number(b),
        0,
      );
      if (!(sum > 0)) {
        throw new BadRequestException('errors.settings.weightsInvalid');
      }
    }
    const data = {
      ...rest,
      ...(financialHealthWeights
        ? { financialHealthWeights: { ...financialHealthWeights } as Prisma.InputJsonValue }
        : {}),
    };
    const result = await this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...data },
      update: data,
    });
    this.settingsCache.invalidate(condominiumId);
    return result;
  }

  async updateFees(condominiumId: string, dto: UpdateFeesSettingsDto) {
    const result = await this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
    this.settingsCache.invalidate(condominiumId);
    return result;
  }

  async updateFinancial(
    condominiumId: string,
    dto: { maxFilesPerImport?: number; allowedFilePdf?: boolean; allowedFileExcel?: boolean },
  ) {
    const result = await this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
    this.settingsCache.invalidate(condominiumId);
    return result;
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
    const result = await this.prisma.condominiumSettings.upsert({
      where: { condominiumId },
      create: { condominiumId, ...dto },
      update: dto,
    });
    this.settingsCache.invalidate(condominiumId);
    return result;
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
    this.settingsCache.invalidate(condominiumId);

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
    this.settingsCache.invalidate(condominiumId);

    return { logoUrl: null, logoUpdatedAt: null, logoUpdatedByName: null };
  }

  private isAbsoluteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }
}
