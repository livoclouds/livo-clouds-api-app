import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReconciliationRuleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitPatterns?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conceptType?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  confidenceThreshold?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
