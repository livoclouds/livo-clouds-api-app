import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum CommonAreaStatusDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  CLOSED = 'CLOSED',
}

export class CreateCommonAreaDto {
  @ApiProperty({ example: 'Gym' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameKey?: string;

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
