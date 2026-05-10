import { IsUUID } from 'class-validator';

export class ManualMatchDto {
  @IsUUID()
  residentId: string;
}
