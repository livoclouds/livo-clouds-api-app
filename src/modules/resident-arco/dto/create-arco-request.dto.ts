import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// DTO-level mirrors of the Prisma enums — local so the validation contract is
// explicit and independent of the generated client.
export enum ArcoRequestTypeDto {
  ACCESS = 'ACCESS',
  RECTIFICATION = 'RECTIFICATION',
  CANCELLATION = 'CANCELLATION',
  OPPOSITION = 'OPPOSITION',
}

export enum ArcoRequestStatusDto {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  RECEIVED = 'RECEIVED',
  IN_REVIEW = 'IN_REVIEW',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

export enum ArcoLegalBasisDto {
  CONSENT = 'CONSENT',
  CONTRACT = 'CONTRACT',
  LEGAL_OBLIGATION = 'LEGAL_OBLIGATION',
  VITAL_INTEREST = 'VITAL_INTEREST',
  PUBLIC_TASK = 'PUBLIC_TASK',
  LEGITIMATE_INTEREST = 'LEGITIMATE_INTEREST',
}

export enum ArcoIdentityVerificationMethodDto {
  GOVERNMENT_ID = 'GOVERNMENT_ID',
  PASSPORT = 'PASSPORT',
  CURP = 'CURP',
  AGENT_NOTARIZED = 'AGENT_NOTARIZED',
  OTHER = 'OTHER',
}

export enum ArcoRequesterIdTypeDto {
  INE = 'INE',
  PASSPORT = 'PASSPORT',
  CURP = 'CURP',
  OTHER = 'OTHER',
}

export enum ArcoRequesterRelationshipDto {
  SELF = 'SELF',
  LEGAL_AGENT = 'LEGAL_AGENT',
  AUTHORIZED_REPRESENTATIVE = 'AUTHORIZED_REPRESENTATIVE',
}

const MAX = {
  channel: 120,
  description: 4000,
  resolution: 4000,
  folio: 120,
  rejectionReason: 4000,
  requesterName: 200,
  requesterIdNumber: 64,
} as const;

// Coerces a multipart/JSON boolean: real booleans pass through; the strings
// "true"/"1" are truthy, everything else false. Multipart fields arrive as
// strings, so a plain @IsBoolean would reject them.
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

export class CreateArcoRequestDto {
  @ApiProperty({ enum: ArcoRequestTypeDto })
  @IsEnum(ArcoRequestTypeDto)
  type: ArcoRequestTypeDto;

  @ApiPropertyOptional({ enum: ArcoRequestStatusDto, default: ArcoRequestStatusDto.RECEIVED })
  @IsOptional()
  @IsEnum(ArcoRequestStatusDto)
  status?: ArcoRequestStatusDto;

  @ApiPropertyOptional({ example: 'Correo electrónico' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX.channel)
  channel?: string;

  @ApiProperty({ example: 'Solicita corregir su número de teléfono registrado.' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.description)
  description: string;

  @ApiPropertyOptional({ example: 'Oficio 2026-014' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX.folio)
  referenceFolio?: string;

  @ApiPropertyOptional({ example: '2026-06-04' })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  // --- Compliance: legal basis & identity verification (LFPDPPP Art. 12) ---

  @ApiPropertyOptional({ enum: ArcoLegalBasisDto })
  @IsOptional()
  @IsEnum(ArcoLegalBasisDto)
  legalBasis?: ArcoLegalBasisDto;

  @ApiPropertyOptional({ example: 'María Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX.requesterName)
  requesterName?: string;

  @ApiPropertyOptional({ enum: ArcoRequesterRelationshipDto })
  @IsOptional()
  @IsEnum(ArcoRequesterRelationshipDto)
  requesterRelationship?: ArcoRequesterRelationshipDto;

  @ApiPropertyOptional({ enum: ArcoRequesterIdTypeDto })
  @IsOptional()
  @IsEnum(ArcoRequesterIdTypeDto)
  requesterIdType?: ArcoRequesterIdTypeDto;

  // Raw ID number — masked at the service boundary before it is persisted.
  @ApiPropertyOptional({ example: 'PEMA800101HDFRRL09' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX.requesterIdNumber)
  requesterIdNumber?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  identityVerified?: boolean;

  @ApiPropertyOptional({ enum: ArcoIdentityVerificationMethodDto })
  @IsOptional()
  @IsEnum(ArcoIdentityVerificationMethodDto)
  identityVerificationMethod?: ArcoIdentityVerificationMethodDto;
}
