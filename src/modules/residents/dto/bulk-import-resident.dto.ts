import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { CreateResidentDto } from './create-resident.dto';
import { CreateVehicleDto } from './create-vehicle.dto';
import { CreatePetDto } from './create-pet.dto';
import { CreateAdditionalResidentDto } from './create-additional-resident.dto';
import { ResidentDocumentationDto } from './resident-documentation.dto';

// Per-resident cap on each kind of sub-entity, so one imported row can't carry
// an unbounded number of nested children. Generous relative to a real unit.
export const MAX_RESIDENT_CHILDREN = 20;

// A bulk-import row: the core resident (CreateResidentDto) plus the optional
// 1:1 documentation flags and 1:N sub-entities created in the same transaction.
// Each nested value reuses the existing single-create DTOs, so a child gets the
// same validation as if it were added one-by-one.
export class BulkImportResidentDto extends CreateResidentDto {
  @ApiPropertyOptional({ type: ResidentDocumentationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResidentDocumentationDto)
  documentation?: ResidentDocumentationDto;

  @ApiPropertyOptional({ type: [CreateVehicleDto], maxItems: MAX_RESIDENT_CHILDREN })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RESIDENT_CHILDREN)
  @ValidateNested({ each: true })
  @Type(() => CreateVehicleDto)
  vehicles?: CreateVehicleDto[];

  @ApiPropertyOptional({ type: [CreatePetDto], maxItems: MAX_RESIDENT_CHILDREN })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RESIDENT_CHILDREN)
  @ValidateNested({ each: true })
  @Type(() => CreatePetDto)
  pets?: CreatePetDto[];

  @ApiPropertyOptional({
    type: [CreateAdditionalResidentDto],
    maxItems: MAX_RESIDENT_CHILDREN,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RESIDENT_CHILDREN)
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalResidentDto)
  additionalResidents?: CreateAdditionalResidentDto[];
}
