import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../common/types';

export class CreateUserDto {
  @ApiProperty({ example: 'user@cotoalameda.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass1!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: UserRole, example: UserRole.TENANT_ADMIN })
  @IsEnum(UserRole)
  role: UserRole;

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
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  sessionDuration?: number;

  @ApiPropertyOptional({
    default: 15,
    description: 'Minutes of inactivity before the in-app screen lock engages',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  inactivityLockMinutes?: number;
}
