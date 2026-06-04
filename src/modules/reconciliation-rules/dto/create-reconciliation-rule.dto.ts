import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconciliationRuleKind } from '@prisma/client';
import {
  SafeRegexConstraint,
  UnitOutcomeShapeConstraint,
} from '../validators/unit-rule.validators';

export class CreateReconciliationRuleDto {
  @ApiProperty()
  @IsString()
  // Object-level guard, attached to an always-present field so it runs on create:
  // a UNIT rule carries exactly one outcome; a CONCEPT rule carries none.
  @Validate(UnitOutcomeShapeConstraint)
  name: string;

  @ApiPropertyOptional({
    enum: ReconciliationRuleKind,
    default: ReconciliationRuleKind.CONCEPT,
  })
  @IsOptional()
  @IsEnum(ReconciliationRuleKind)
  ruleKind?: ReconciliationRuleKind;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitPatterns?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conceptType?: string;

  // EXPENSE outcome — the category and/or supplier to stamp on a matched expense.
  // At least one is required for an EXPENSE rule (enforced by UnitOutcomeShape).
  @ApiPropertyOptional({ description: 'Expense category id for an EXPENSE rule' })
  @ValidateIf((o) => o.ruleKind === ReconciliationRuleKind.EXPENSE)
  @IsOptional()
  @IsString()
  expenseCategoryId?: string;

  @ApiPropertyOptional({ description: 'Supplier id for an EXPENSE rule' })
  @ValidateIf((o) => o.ruleKind === ReconciliationRuleKind.EXPENSE)
  @IsOptional()
  @IsString()
  supplierId?: string;

  // UNIT outcome — flavor 1 (direct assignment). Required for a UNIT rule that has
  // no extraction pattern.
  @ApiPropertyOptional({ description: 'Fixed unit number for a UNIT/direct rule' })
  @ValidateIf(
    (o) =>
      o.ruleKind === ReconciliationRuleKind.UNIT && !o.unitExtractionPattern,
  )
  @IsString()
  @IsNotEmpty()
  assignedUnitNumber?: string;

  // UNIT outcome — flavor 2 (format extraction). Required and safety-validated for
  // a UNIT rule that has no fixed assignment.
  @ApiPropertyOptional({
    description: 'Regex with one capture group for a UNIT/extraction rule',
  })
  @ValidateIf(
    (o) => o.ruleKind === ReconciliationRuleKind.UNIT && !o.assignedUnitNumber,
  )
  @Validate(SafeRegexConstraint)
  unitExtractionPattern?: string;

  @ApiPropertyOptional({ default: 1, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  unitExtractionGroup?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  confidenceThreshold?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
