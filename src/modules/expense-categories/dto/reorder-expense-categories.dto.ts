import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Reorder expense categories. The body must list every (non-deleted) category of
 * the condominium exactly once, in the new desired order.
 */
export class ReorderExpenseCategoriesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  categoryIds: string[];
}
