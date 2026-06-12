import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class ReorderSupplierCategoriesDto {
  @ApiProperty({ type: [String], description: 'All category IDs in the new desired order.' })
  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];
}
