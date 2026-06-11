import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ArcoRequestStatusDto, ArcoRequestTypeDto } from './create-arco-request.dto';

// Filters for the regulator-ready CSV export (RP-012). `from`/`to` bound the
// receivedAt date range; type/status narrow the set.
export class ExportArcoRequestsDto {
  @ApiPropertyOptional({ enum: ArcoRequestTypeDto })
  @IsOptional()
  @IsEnum(ArcoRequestTypeDto)
  type?: ArcoRequestTypeDto;

  @ApiPropertyOptional({ enum: ArcoRequestStatusDto })
  @IsOptional()
  @IsEnum(ArcoRequestStatusDto)
  status?: ArcoRequestStatusDto;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
