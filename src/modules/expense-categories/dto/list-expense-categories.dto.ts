import { IsBooleanString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListExpenseCategoriesDto {
  /**
   * When "true", include inactive categories. Defaults to active-only so the
   * review modal and rule editor only offer usable categories.
   */
  @ApiPropertyOptional({ description: 'Include inactive categories', example: 'true' })
  @IsOptional()
  @IsBooleanString()
  includeInactive?: string;
}
