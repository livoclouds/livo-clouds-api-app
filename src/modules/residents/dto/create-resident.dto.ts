import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum ResidentTypeDto {
  OWNER = 'OWNER',
  CO_OWNER = 'CO_OWNER',
  RESIDENT = 'RESIDENT',
  TENANT = 'TENANT',
}

export class CreateResidentDto {
  @ApiProperty({ example: 'A01' })
  @IsString()
  @MinLength(1)
  unitNumber: string;

  @ApiProperty({ enum: ResidentTypeDto, default: ResidentTypeDto.OWNER })
  @IsEnum(ResidentTypeDto)
  residentType: ResidentTypeDto;

  @ApiProperty({ example: 'Carlos' })
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiProperty({ example: 'Mendoza' })
  @IsString()
  @MinLength(1)
  lastName: string;

  @ApiPropertyOptional({ example: '+52 81 1234 5678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  secondaryPhone?: string;

  @ApiPropertyOptional({ example: 'carlos@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  monthlyFee?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  parkingSpots?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
