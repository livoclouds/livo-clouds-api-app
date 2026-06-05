import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddDossierNoteDto {
  @ApiProperty({ example: 'Se notificó al residente vía oficio.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note: string;
}
