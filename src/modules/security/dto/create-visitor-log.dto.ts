import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVisitorLogDto {
  @ApiProperty({ example: 'Juan Pérez', description: 'Visitor full name.' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  visitorName: string;

  @ApiProperty({ example: 'A-101', description: 'Unit / apartment being visited.' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  unit: string;

  @ApiPropertyOptional({ description: 'Resident being visited (directory link).' })
  @IsOptional()
  @IsUUID()
  residentId?: string;

  @ApiPropertyOptional({ example: 'ABC-123', description: 'Visitor vehicle plate.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Check-in time (ISO-8601). Defaults to now when omitted.',
  })
  @IsOptional()
  @IsISO8601()
  checkInAt?: string;
}
