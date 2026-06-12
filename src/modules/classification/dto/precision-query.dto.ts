import { IsISO8601, IsOptional } from 'class-validator';

// ENGINE-058 — optional time window for the precision metrics. Defaults to
// all-time when omitted (the harness baseline wants the full history).
export class PrecisionQueryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'from must be an ISO 8601 date' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be an ISO 8601 date' })
  to?: string;
}
