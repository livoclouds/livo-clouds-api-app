import { IsArray, IsIn, IsUUID, ArrayMaxSize, ArrayMinSize } from 'class-validator';

export class BulkReconcileDto {
  @IsIn(['approve', 'ignore', 'reopen'])
  action: 'approve' | 'ignore' | 'reopen';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(4, { each: true })
  ids: string[];
}
