import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconciliationRuleKind } from '@prisma/client';
import {
  MAX_EXTRACTION_PATTERN_LENGTH,
  SafeRegexConstraint,
  SafeTriggerPatternConstraint,
  UnitOutcomeShapeConstraint,
} from '../validators/unit-rule.validators';
import { ExtractionRecipeShapeConstraint } from '../validators/extraction-recipe.validators';

export class CreateReconciliationRuleDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
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
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords: string[];

  // ENGINE-041: each trigger is RE2 compile-checked at save time — an invalid
  // entry used to be accepted and then silently never fire (a dead rule).
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(MAX_EXTRACTION_PATTERN_LENGTH, { each: true })
  @Validate(SafeTriggerPatternConstraint, { each: true })
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
  @ApiPropertyOptional({ description: 'Fixed unit number for a UNIT/direct rule', maxLength: 40 })
  @ValidateIf(
    (o) =>
      o.ruleKind === ReconciliationRuleKind.UNIT && !o.unitExtractionPattern,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
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

  // UNIT outcome — flavor 2 metadata. The visual block recipe the editor built;
  // engine-ignored (classification runs unitExtractionPattern). Persisted so the
  // editor can faithfully rebuild the block builder on edit. Not part of the
  // UNIT XOR — it is metadata, not an outcome.
  @ApiPropertyOptional({
    description:
      'Visual block recipe { nodes, captureId } for the advanced block builder (engine-ignored metadata)',
  })
  @IsOptional()
  @Validate(ExtractionRecipeShapeConstraint)
  extractionRecipe?: unknown;

  // ENGINE-015: this is the confidence ASSIGNED to the rule's matches (stamped
  // as the transaction's confidenceScore); the engine's fixed 0.8 AUTO gate
  // decides auto-classify vs manual review. The name is historical.
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 1,
    default: 0.8,
    description:
      "Confidence assigned to this rule's matches (>= 0.80 auto-classifies; below goes to manual review)",
  })
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
