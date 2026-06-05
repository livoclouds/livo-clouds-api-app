import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { DossierCategoryDto, DossierStatusDto } from './create-dossier-entry.dto';

export class ListDossierEntriesDto {
  @ApiPropertyOptional({ enum: DossierCategoryDto })
  @IsOptional()
  @IsEnum(DossierCategoryDto)
  category?: DossierCategoryDto;

  @ApiPropertyOptional({ enum: DossierStatusDto })
  @IsOptional()
  @IsEnum(DossierStatusDto)
  status?: DossierStatusDto;

  // When true, lists soft-deleted entries (the recycle bin) instead of live
  // ones — gated to `manage` in the service. Accepts the string "true" from the
  // query string.
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  deleted?: boolean;
}
