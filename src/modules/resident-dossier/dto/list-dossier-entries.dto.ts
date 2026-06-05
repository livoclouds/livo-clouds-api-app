import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
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
}
