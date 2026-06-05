import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
  RECEIVED = 'RECEIVED',
  IN_REVIEW = 'IN_REVIEW',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

const MAX = {
  channel: 120,
  description: 4000,
  resolution: 4000,
  folio: 120,
} as const;

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
}
