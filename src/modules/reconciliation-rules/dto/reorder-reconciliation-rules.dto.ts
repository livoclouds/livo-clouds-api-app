import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderReconciliationRulesDto {
  @ApiProperty({
    type: [String],
    description:
      'Rule IDs in the new desired order. Must contain every rule belonging to the condominium exactly once.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ruleIds!: string[];
}
