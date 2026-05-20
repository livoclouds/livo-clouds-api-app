import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export type AnalyticsGranularity = 'day' | 'week' | 'month';

/**
 * Query parameters for the communications analytics summary (Phase 5).
 * All fields are optional — the service applies a safe default 30-day window.
 */
export class AnalyticsQueryDto {
  /** Inclusive ISO-8601 range start. Defaults to 30 days ago. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Exclusive ISO-8601 range end. Defaults to now. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Bucket size for the conversations-over-time series. Defaults to `day`. */
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: AnalyticsGranularity;
}
