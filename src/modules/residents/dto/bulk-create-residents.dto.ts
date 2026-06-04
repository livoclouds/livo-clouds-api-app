import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateResidentDto } from './create-resident.dto';

// Bulk-import payload: an array of the same rows the single-create endpoint
// accepts. Each row is validated with the existing CreateResidentDto rules
// (@ValidateNested + @Type), so a malformed row rejects the whole request with
// 400 — the web client only ever sends rows that passed its client-side review,
// so this is a defense-in-depth boundary, not the primary error channel.
// Duplicate units are not an error here; the service skips them and reports
// them in the response (see ResidentsService.bulkCreate).
export class BulkCreateResidentsDto {
  @ApiProperty({
    description: 'Residents to create in a single import.',
    type: [CreateResidentDto],
    maxItems: 500,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateResidentDto)
  residents!: CreateResidentDto[];
}
