import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateVehicleDto {
  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @MinLength(1)
  make: string;

  @ApiProperty({ example: 'Corolla' })
  @IsString()
  @MinLength(1)
  model: string;

  @ApiPropertyOptional({ example: 'White' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ example: 'ABC-1234' })
  @IsString()
  @MinLength(1)
  plates: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasTag?: boolean;

  @ApiPropertyOptional({ example: 'TAG-0042' })
  @IsOptional()
  @IsString()
  tagId?: string;
}
