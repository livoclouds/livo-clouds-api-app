import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SendMessageDto {
  @IsIn(['TEXT', 'IMAGE', 'DOCUMENT'])
  type: 'TEXT' | 'IMAGE' | 'DOCUMENT';

  @ValidateIf((o: SendMessageDto) => o.type === 'TEXT')
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  textContent?: string;

  @ValidateIf((o: SendMessageDto) => o.type !== 'TEXT')
  @IsString()
  @MinLength(1)
  @MaxLength(40_000_000)
  mediaBase64?: string;

  @ValidateIf((o: SendMessageDto) => o.type !== 'TEXT')
  @IsString()
  @MaxLength(255)
  mediaMimeType?: string;

  @ValidateIf((o: SendMessageDto) => o.type === 'DOCUMENT')
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  mediaFilename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  mediaCaption?: string;
}
