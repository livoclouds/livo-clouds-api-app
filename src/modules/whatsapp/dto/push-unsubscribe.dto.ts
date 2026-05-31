import { IsOptional, IsString } from 'class-validator';

/**
 * Body for `push-unsubscribe` (notifications iter2 — multi-device).
 *
 * `endpoint` identifies the single device to unsubscribe so the user's other
 * devices keep receiving push. When omitted, every subscription for the current
 * (userId, condominiumId) is removed — a full opt-out.
 */
export class PushUnsubscribeDto {
  @IsOptional()
  @IsString()
  endpoint?: string;
}
