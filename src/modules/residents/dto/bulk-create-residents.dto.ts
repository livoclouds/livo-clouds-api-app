import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { BulkImportResidentDto } from './bulk-import-resident.dto';

// Bulk-import payload: an array of import rows, each a core resident plus its
// optional documentation flags and 1:N sub-entities (see BulkImportResidentDto).
// Each row is validated with the same rules as a single create + add-child
// (@ValidateNested + @Type), so a malformed row rejects the whole request with
// 400 — the web client only ever sends rows that passed its client-side review,
// so this is a defense-in-depth boundary, not the primary error channel.
// Duplicate units are not an error here; the service skips them and reports
// them in the response (see ResidentsService.bulkCreate).
export class BulkCreateResidentsDto {
  @ApiProperty({
    description: 'Residents (with optional documentation + sub-entities) to create in a single import.',
    type: [BulkImportResidentDto],
    maxItems: 500,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkImportResidentDto)
  residents!: BulkImportResidentDto[];
}
