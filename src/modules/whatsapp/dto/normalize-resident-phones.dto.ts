import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class NormalizeResidentPhonesDto {
  /**
   * When false (default) the endpoint runs as a dry-run and persists nothing.
   * When true the safe `normalized` outcomes are written to the database.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  apply?: boolean;
}
