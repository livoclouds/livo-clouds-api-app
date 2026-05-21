import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ResidentTypeDto } from './create-resident.dto';

// Create contract for an additional resident (a co-habitant of a unit, distinct
// from the primary Resident). Unsafe fields (`id`, `residentId`, `createdAt`,
// `updatedAt`) are intentionally not declared — ValidationPipe's whitelist
// strips them, and `residentId` is taken from the route, never the body.
export class CreateAdditionalResidentDto {
  @ApiProperty({ example: 'María González' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ enum: ResidentTypeDto, default: ResidentTypeDto.RESIDENT })
  @IsOptional()
  @IsEnum(ResidentTypeDto)
  residentType?: ResidentTypeDto;

  @ApiPropertyOptional({ example: '+52 81 1234 5678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  secondaryPhone?: string;

  @ApiPropertyOptional({ example: 'maria@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Spouse' })
  @IsOptional()
  @IsString()
  relationship?: string;
}
