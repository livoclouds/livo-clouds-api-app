import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class UpdateTerraceSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  terraceBookingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  terraceRentalAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  terraceSecurityDepositAmount?: number;

  @ApiPropertyOptional({ description: 'HH:MM format, e.g. "10:00"' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'terraceDefaultStartTime must be in HH:MM format' })
  terraceDefaultStartTime?: string;

  @ApiPropertyOptional({ description: 'HH:MM format, e.g. "11:00"' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'terraceDefaultEndTime must be in HH:MM format' })
  terraceDefaultEndTime?: string;
}
