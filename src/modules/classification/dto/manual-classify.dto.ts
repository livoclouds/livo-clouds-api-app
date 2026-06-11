import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One slice of a multi-house payment: a portion of the credit assigned to a
 * specific unit and the resident who lives there. The sum of all slices must
 * equal the transaction credit (validated server-side).
 */
export class AllocationItemDto {
  @IsString()
  unitNumber: string;

  @IsUUID()
  residentId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  allocatedAmount: number;
}

export class ManualClassifyDto {
  @IsOptional()
  @IsString()
  unitNumber?: string;

  // Multi-unit split: when present, the transaction is allocated across these
  // houses (one PaymentAllocation row each) instead of linked to a single
  // resident. Absent => the single-unit `unitNumber` path (backward compatible).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations?: AllocationItemDto[];

  @IsOptional()
  @IsString()
  paymentConcept?: string;

  // EXPENSE-side classification. Empty string clears the field. Only meaningful on
  // EXPENSE transactions; the web app sends these instead of paymentConcept there.
  @IsOptional()
  @IsString()
  expenseCategoryId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  paymentPeriodMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  paymentPeriodYear?: number;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
