import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../common/types';
import {
  DEFAULT_FIELD_DEFINITIONS,
  type FieldDefinition,
  SYSTEM_FIELD_KEYS,
} from '../imports/parser';
import { CreateBankProfileDto } from './dto/create-bank-profile.dto';
import { UpdateBankProfileDto } from './dto/update-bank-profile.dto';
import { FieldDefinitionDto } from './dto/field-definition.dto';

@Injectable()
export class BankProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(condominiumId: string) {
    const profiles = await this.prisma.bankProfile.findMany({
      where: { condominiumId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return { data: profiles, total: profiles.length };
  }

  async findOne(condominiumId: string, id: string) {
    return this.findOneOrFail(condominiumId, id);
  }

  async findDefault(condominiumId: string) {
    const profile = await this.prisma.bankProfile.findFirst({
      where: { condominiumId, isActive: true, isDefault: true },
    });
    if (profile) return profile;
    return this.prisma.bankProfile.findFirst({
      where: { condominiumId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    condominiumId: string,
    dto: CreateBankProfileDto,
    user: JwtPayload,
  ) {
    this.validateFieldDefinitions(dto.excelAliases, 'excelAliases');
    if (dto.pdfAliases) {
      this.validateFieldDefinitions(dto.pdfAliases, 'pdfAliases');
    }

    const existing = await this.prisma.bankProfile.findUnique({
      where: { condominiumId_name: { condominiumId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'BANK_PROFILE_NAME_TAKEN',
        reason: `A bank profile with name "${dto.name}" already exists in this condominium.`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.bankProfile.updateMany({
          where: { condominiumId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.bankProfile.create({
        data: {
          condominiumId,
          name: dto.name,
          bankName: dto.bankName ?? null,
          isDefault: dto.isDefault ?? false,
          useSameForPdf: dto.useSameForPdf ?? true,
          excelAliases: dto.excelAliases as unknown as Prisma.InputJsonValue,
          pdfAliases: (dto.pdfAliases ?? []) as unknown as Prisma.InputJsonValue,
          createdBy: user.sub,
          updatedBy: user.sub,
        },
      });

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId: user.sub,
          action: 'BANK_PROFILE_CREATED',
          actionCategory: 'SETTINGS',
          module: 'bank-profiles',
          entityType: 'BankProfile',
          entityId: created.id,
          afterState: { name: created.name, isDefault: created.isDefault },
          result: 'SUCCESS',
        },
      });

      return created;
    });
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateBankProfileDto,
    user: JwtPayload,
  ) {
    const existing = await this.findOneOrFail(condominiumId, id);

    if (dto.excelAliases) {
      this.validateFieldDefinitions(dto.excelAliases, 'excelAliases');
    }
    if (dto.pdfAliases) {
      this.validateFieldDefinitions(dto.pdfAliases, 'pdfAliases');
    }

    if (dto.name && dto.name !== existing.name) {
      const dupe = await this.prisma.bankProfile.findUnique({
        where: { condominiumId_name: { condominiumId, name: dto.name } },
      });
      if (dupe) {
        throw new ConflictException({
          code: 'BANK_PROFILE_NAME_TAKEN',
          reason: `A bank profile with name "${dto.name}" already exists in this condominium.`,
        });
      }
    }

    const data: Prisma.BankProfileUpdateInput = { updatedBy: user.sub };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.bankName !== undefined) data.bankName = dto.bankName;
    if (dto.useSameForPdf !== undefined) data.useSameForPdf = dto.useSameForPdf;
    if (dto.excelAliases !== undefined) {
      data.excelAliases = dto.excelAliases as unknown as Prisma.InputJsonValue;
    }
    if (dto.pdfAliases !== undefined) {
      data.pdfAliases = dto.pdfAliases as unknown as Prisma.InputJsonValue;
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true && !existing.isDefault) {
        await tx.bankProfile.updateMany({
          where: { condominiumId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
        data.isDefault = true;
      } else if (dto.isDefault === false) {
        data.isDefault = false;
      }

      const updated = await tx.bankProfile.update({ where: { id }, data });

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId: user.sub,
          action: 'BANK_PROFILE_UPDATED',
          actionCategory: 'SETTINGS',
          module: 'bank-profiles',
          entityType: 'BankProfile',
          entityId: id,
          beforeState: {
            name: existing.name,
            isDefault: existing.isDefault,
          },
          afterState: {
            name: updated.name,
            isDefault: updated.isDefault,
          },
          result: 'SUCCESS',
        },
      });

      return updated;
    });
  }

  async setDefault(condominiumId: string, id: string, user: JwtPayload) {
    const profile = await this.findOneOrFail(condominiumId, id);
    if (profile.isDefault) return profile;

    return this.prisma.$transaction(async (tx) => {
      await tx.bankProfile.updateMany({
        where: { condominiumId, isDefault: true },
        data: { isDefault: false },
      });
      const updated = await tx.bankProfile.update({
        where: { id },
        data: { isDefault: true, updatedBy: user.sub },
      });

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId: user.sub,
          action: 'BANK_PROFILE_SET_DEFAULT',
          actionCategory: 'SETTINGS',
          module: 'bank-profiles',
          entityType: 'BankProfile',
          entityId: id,
          afterState: { name: updated.name },
          result: 'SUCCESS',
        },
      });

      return updated;
    });
  }

  async remove(condominiumId: string, id: string, user: JwtPayload) {
    const profile = await this.findOneOrFail(condominiumId, id);
    const referenced = await this.prisma.importBatch.count({
      where: { bankProfileId: id },
    });

    if (referenced > 0) {
      const updated = await this.prisma.bankProfile.update({
        where: { id },
        data: { isActive: false, isDefault: false, updatedBy: user.sub },
      });
      await this.prisma.auditLog.create({
        data: {
          condominiumId,
          userId: user.sub,
          action: 'BANK_PROFILE_DEACTIVATED',
          actionCategory: 'SETTINGS',
          module: 'bank-profiles',
          entityType: 'BankProfile',
          entityId: id,
          beforeState: { name: profile.name, isActive: true },
          afterState: { isActive: false, referencedBatches: referenced },
          result: 'SUCCESS',
        },
      });
      return { id, action: 'deactivated', referencedBatches: referenced };
    }

    await this.prisma.bankProfile.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId: user.sub,
        action: 'BANK_PROFILE_DELETED',
        actionCategory: 'SETTINGS',
        module: 'bank-profiles',
        entityType: 'BankProfile',
        entityId: id,
        beforeState: { name: profile.name },
        result: 'SUCCESS',
      },
    });
    return { id, action: 'deleted', referencedBatches: 0 };
  }

  async getDefaultFieldDefinitions(): Promise<FieldDefinition[]> {
    return DEFAULT_FIELD_DEFINITIONS;
  }

  async resolveFieldsForBatch(params: {
    condominiumId: string;
    bankProfileId?: string;
    fileType: 'xlsx' | 'pdf';
  }): Promise<{ profileId: string | null; profileName: string | null; fields: FieldDefinition[] }> {
    const profile = params.bankProfileId
      ? await this.prisma.bankProfile.findFirst({
          where: {
            id: params.bankProfileId,
            condominiumId: params.condominiumId,
            isActive: true,
          },
        })
      : await this.findDefault(params.condominiumId);

    if (!profile) {
      return {
        profileId: null,
        profileName: null,
        fields: DEFAULT_FIELD_DEFINITIONS,
      };
    }

    const useExcelForPdf = params.fileType === 'pdf' && profile.useSameForPdf;
    const source =
      params.fileType === 'xlsx' || useExcelForPdf
        ? profile.excelAliases
        : profile.pdfAliases;

    const fields = this.parseFieldsJson(source);
    return {
      profileId: profile.id,
      profileName: profile.name,
      fields: fields.length > 0 ? fields : DEFAULT_FIELD_DEFINITIONS,
    };
  }

  private async findOneOrFail(condominiumId: string, id: string) {
    const profile = await this.prisma.bankProfile.findFirst({
      where: { id, condominiumId },
    });
    if (!profile) {
      throw new NotFoundException({
        code: 'BANK_PROFILE_NOT_FOUND',
        reason: `Bank profile ${id} not found in this condominium.`,
      });
    }
    return profile;
  }

  private validateFieldDefinitions(
    fields: FieldDefinitionDto[],
    where: 'excelAliases' | 'pdfAliases',
  ): void {
    const seenKeys = new Set<string>();
    for (const f of fields) {
      if (seenKeys.has(f.key)) {
        throw new BadRequestException({
          code: 'BANK_PROFILE_DUPLICATE_FIELD_KEY',
          reason: `Duplicate field key "${f.key}" in ${where}.`,
        });
      }
      seenKeys.add(f.key);
      const dedupedAliases = new Set(
        f.aliases
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a.length > 0),
      );
      if (dedupedAliases.size === 0) {
        throw new BadRequestException({
          code: 'BANK_PROFILE_EMPTY_ALIASES',
          reason: `Field "${f.key}" in ${where} must have at least one non-empty alias.`,
        });
      }
    }

    if (where === 'excelAliases') {
      for (const required of SYSTEM_FIELD_KEYS) {
        const match = fields.find((f) => f.key === required);
        if (!match) {
          throw new BadRequestException({
            code: 'BANK_PROFILE_MISSING_SYSTEM_FIELD',
            reason: `System field "${required}" is required in ${where}.`,
            missingFieldKey: required,
          });
        }
        if (!match.system || !match.required) {
          throw new BadRequestException({
            code: 'BANK_PROFILE_SYSTEM_FIELD_FLAGS',
            reason: `System field "${required}" must have system=true and required=true.`,
          });
        }
      }
    }
  }

  private parseFieldsJson(value: unknown): FieldDefinition[] {
    if (!Array.isArray(value)) return [];
    const out: FieldDefinition[] = [];
    for (const entry of value) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).key === 'string' &&
        typeof (entry as Record<string, unknown>).label === 'string' &&
        Array.isArray((entry as Record<string, unknown>).aliases)
      ) {
        const e = entry as Record<string, unknown>;
        out.push({
          key: String(e.key),
          label: String(e.label),
          system: Boolean(e.system),
          required: Boolean(e.required),
          aliases: (e.aliases as unknown[]).map((a) => String(a)),
        });
      }
    }
    return out;
  }
}
