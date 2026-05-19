import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FieldDefinitionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  key: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  label: string;

  @ApiProperty()
  @IsBoolean()
  system: boolean;

  @ApiProperty()
  @IsBoolean()
  required: boolean;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsString({ each: true })
  aliases: string[];
}
