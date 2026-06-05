import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// One rating event for a supplier. The displayed score is the AVERAGE of all
// such events, so this is an append-only history rather than an editable field.
export class RateSupplierDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @ApiPropertyOptional({ example: 'Trabajo puntual y bien terminado.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
