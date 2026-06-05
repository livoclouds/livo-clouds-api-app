import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ResidentTypeDto {
  OWNER = 'OWNER',
  CO_OWNER = 'CO_OWNER',
  RESIDENT = 'RESIDENT',
  TENANT = 'TENANT',
}

// Upper bounds guard against unbounded input — a single create is harmless, but
// the bulk-import endpoint accepts up to 500 rows per request, so an oversized
// cell would otherwise be amplified into large DB writes. Caps are generous
// relative to real condominium data and shared across create + bulk.
const MAX = {
  unitNumber: 32,
  name: 64,
  phone: 32,
  email: 254, // RFC 5321 max email length
  houseModel: 64,
  notes: 1000,
} as const;

// Parking spots are a small physical count; the web UI offers 0–10, so reject
// anything outside that range rather than letting an import write an absurd value.
const MAX_PARKING_SPOTS = 10;

export class CreateResidentDto {
  @ApiProperty({ example: 'A01' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.unitNumber)
  unitNumber: string;

  @ApiProperty({ enum: ResidentTypeDto, default: ResidentTypeDto.OWNER })
  @IsEnum(ResidentTypeDto)
  residentType: ResidentTypeDto;

  @ApiProperty({ example: 'Carlos' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.name)
  firstName: string;

  @ApiProperty({ example: 'Mendoza' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.name)
  lastName: string;

  @ApiPropertyOptional({ example: '+52 81 1234 5678' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX.phone)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.phone)
  secondaryPhone?: string;

  @ApiPropertyOptional({ example: 'carlos@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(MAX.email)
  email?: string;

  // Per-resident fee override (0 = use the condominium default). `@Type(Number)`
  // + `@IsNumber` replaces the old `@Transform(parseFloat)`, which produced
  // `NaN` when the field was omitted (then failed the Prisma Decimal write).
  // Now an absent value stays `undefined` (service defaults to 0) and a
  // non-numeric or negative value is rejected with a 400 instead of a 500.
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyFee?: number;

  @ApiPropertyOptional({ default: 0, maximum: MAX_PARKING_SPOTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PARKING_SPOTS)
  parkingSpots?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.houseModel)
  houseModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.notes)
  notes?: string;
}
