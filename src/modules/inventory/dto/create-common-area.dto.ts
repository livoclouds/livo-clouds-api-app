import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum CommonAreaStatusDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  CLOSED = 'CLOSED',
}

export class CreateCommonAreaDto {
  // CMA-010 (Phase 5): the free-text `name` is the single source of truth for
  // common-area naming. The legacy `nameKey` i18n-catalogue field was removed
  // from this DTO — the API no longer accepts or persists it.
  @ApiProperty({ example: 'Gym' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2nd floor, Building A' })
  @IsOptional()
  @IsString()
  physicalLocation?: string;

  @ApiPropertyOptional({ enum: CommonAreaStatusDto, default: CommonAreaStatusDto.ACTIVE })
  @IsOptional()
  @IsEnum(CommonAreaStatusDto)
  status?: CommonAreaStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  responsiblePerson?: string;
}
