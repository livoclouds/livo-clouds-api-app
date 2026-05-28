import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BulkDeleteResidentsDto {
  @ApiProperty({
    description: 'IDs of the residents to soft-delete.',
    type: [String],
    maxItems: 200,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}
