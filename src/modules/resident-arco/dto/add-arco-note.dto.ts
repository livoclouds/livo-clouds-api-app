import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddArcoNoteDto {
  @ApiProperty({ example: 'Se solicitó identificación oficial al titular.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note: string;
}
