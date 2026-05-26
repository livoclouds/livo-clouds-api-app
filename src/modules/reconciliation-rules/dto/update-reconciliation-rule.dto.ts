import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateReconciliationRuleDto } from './create-reconciliation-rule.dto';

export class UpdateReconciliationRuleDto extends PartialType(CreateReconciliationRuleDto) {
  @ApiPropertyOptional({ minimum: 1, description: 'New execution priority (1 = highest). Triggers a full reorder.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  priority?: number;
}
