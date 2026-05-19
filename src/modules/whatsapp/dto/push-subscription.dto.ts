import { IsObject, IsOptional } from 'class-validator';

export class PushSubscriptionDto {
  @IsOptional()
  @IsObject()
  subscription?: Record<string, unknown>;
}
