import { PartialType } from '@nestjs/swagger';
import { CreateReconciliationRuleDto } from './create-reconciliation-rule.dto';

export class UpdateReconciliationRuleDto extends PartialType(CreateReconciliationRuleDto) {}
