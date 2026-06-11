import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  ArcoIdentityVerificationMethodDto,
  ArcoLegalBasisDto,
  ArcoRequesterIdTypeDto,
  ArcoRequesterRelationshipDto,
  ArcoRequestStatusDto,
  ArcoRequestTypeDto,
} from './create-arco-request.dto';

const MAX = {
  channel: 120,
  resolution: 4000,
  folio: 120,
  rejectionReason: 4000,
  requesterName: 200,
  requesterIdNumber: 64,
} as const;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

export class UpdateArcoRequestDto {
  @ApiPropertyOptional({ enum: ArcoRequestTypeDto })
  @IsOptional()
  @IsEnum(ArcoRequestTypeDto)
  type?: ArcoRequestTypeDto;

  @ApiPropertyOptional({ enum: ArcoRequestStatusDto })
  @IsOptional()
  @IsEnum(ArcoRequestStatusDto)
  status?: ArcoRequestStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.channel)
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.resolution)
  resolution?: string;

  // Mandatory written justification when status transitions to REJECTED. The
  // cross-field rule (required-if-REJECTED) is enforced in the service.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.rejectionReason)
  rejectionReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.folio)
  referenceFolio?: string;

  @ApiPropertyOptional({ example: '2026-06-20' })
  @IsOptional()
  @IsISO8601()
  resolvedAt?: string;

  // Optional internal note recorded alongside the edit (RP-032). Routed to the
  // append-only timeline as a NOTE_ADDED event; never sent to the data subject.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;

  // --- Compliance: legal basis & identity verification (LFPDPPP Art. 12) ---

  @ApiPropertyOptional({ enum: ArcoLegalBasisDto })
  @IsOptional()
  @IsEnum(ArcoLegalBasisDto)
  legalBasis?: ArcoLegalBasisDto;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.requesterIdNumber)
  requesterIdNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  identityVerified?: boolean;

  @ApiPropertyOptional({ enum: ArcoIdentityVerificationMethodDto })
  @IsOptional()
  @IsEnum(ArcoIdentityVerificationMethodDto)
  identityVerificationMethod?: ArcoIdentityVerificationMethodDto;
}
