import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'Council / Auditor' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ example: 'Read-only access for the condominium board' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Permission keys from the catalog (validated server-side)',
    example: ['dashboard.read', 'reports.read', 'audit.read'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissions: string[];
}
