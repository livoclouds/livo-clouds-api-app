import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for creating an expense category. `systemKey`, `isSystem` and `sortOrder`
 * are API-owned and never accepted from the request — custom categories are
 * always non-system and appended to the end of the list.
 */
export class CreateExpenseCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ description: 'Optional badge/chart color token (hex or hsl).' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
