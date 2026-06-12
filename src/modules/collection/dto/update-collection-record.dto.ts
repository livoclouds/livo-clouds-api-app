import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CollectionStatus } from '@prisma/client';

export class UpdateCollectionRecordDto {
  @ApiPropertyOptional({ enum: CollectionStatus })
  @IsOptional()
  @IsEnum(CollectionStatus)
  status?: CollectionStatus;

  @ApiPropertyOptional({ minimum: 0, maximum: 9_999_999 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999)
  amountPaid?: number;

  @ApiPropertyOptional({ description: 'ISO 8601 date string for the payment date' })
  @IsOptional()
  @IsISO8601()
  paymentDate?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
