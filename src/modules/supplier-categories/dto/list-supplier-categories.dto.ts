import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListSupplierCategoriesDto {
  @ApiPropertyOptional({ description: 'When "true", includes inactive categories.' })
  @IsOptional()
  @IsString()
  includeInactive?: string;
}
