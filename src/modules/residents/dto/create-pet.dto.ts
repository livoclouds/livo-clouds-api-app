import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum PetTypeDto {
  DOG = 'DOG',
  CAT = 'CAT',
  OTHER = 'OTHER',
}

export class CreatePetDto {
  @ApiProperty({ example: 'Max' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ enum: PetTypeDto, default: PetTypeDto.OTHER })
  @IsEnum(PetTypeDto)
  petType: PetTypeDto;

  @ApiPropertyOptional({ example: 'Golden Retriever' })
  @IsOptional()
  @IsString()
  description?: string;
}
