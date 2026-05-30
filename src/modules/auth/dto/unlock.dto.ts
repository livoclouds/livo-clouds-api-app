import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnlockDto {
  @ApiProperty({ description: "Current user's password to lift the screen lock" })
  @IsString()
  @IsNotEmpty()
  password: string;
}
