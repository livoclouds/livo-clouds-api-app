import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsIn(['TEXT'])
  type: 'TEXT';

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  textContent: string;
}
