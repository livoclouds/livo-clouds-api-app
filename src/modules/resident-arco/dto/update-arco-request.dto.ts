import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { ArcoRequestStatusDto, ArcoRequestTypeDto } from './create-arco-request.dto';

const MAX = {
  channel: 120,
  resolution: 4000,
  folio: 120,
} as const;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX.folio)
  referenceFolio?: string;

  @ApiPropertyOptional({ example: '2026-06-20' })
  @IsOptional()
  @IsISO8601()
  resolvedAt?: string;
}
