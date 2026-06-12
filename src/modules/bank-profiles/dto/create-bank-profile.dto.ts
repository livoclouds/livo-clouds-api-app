import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankDialect } from '@prisma/client';
import { FieldDefinitionDto } from './field-definition.dto';

export class CreateBankProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({
    enum: BankDialect,
    description:
      'Bank-specific extraction strategy the classification engine applies to ' +
      'batches imported with this profile (ENGINE-009). Defaults from bankName ' +
      'at create time; explicit values always win.',
  })
  @IsOptional()
  @IsEnum(BankDialect)
  dialect?: BankDialect;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  useSameForPdf?: boolean;

  @ApiProperty({ type: [FieldDefinitionDto] })
  @IsArray()
  @ArrayMinSize(5)
  @ValidateNested({ each: true })
  @Type(() => FieldDefinitionDto)
  excelAliases: FieldDefinitionDto[];

  @ApiPropertyOptional({ type: [FieldDefinitionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldDefinitionDto)
  pdfAliases?: FieldDefinitionDto[];
}
