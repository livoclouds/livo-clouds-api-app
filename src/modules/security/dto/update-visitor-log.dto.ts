import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsISO8601, IsOptional, ValidateIf } from 'class-validator';
import { CreateVisitorLogDto } from './create-visitor-log.dto';

export class UpdateVisitorLogDto extends PartialType(CreateVisitorLogDto) {
  // Set to an ISO timestamp to record the visitor leaving; `null` clears it
  // (e.g. the row was checked out by mistake). Absent leaves it unchanged.
  @ApiPropertyOptional({
    nullable: true,
    description: 'Check-out time (ISO-8601); null re-opens the visit.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  checkOutAt?: string | null;
}
