import { IsString, Matches } from 'class-validator';

export class ValidateNumberDto {
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'phoneNumber must be E.164 format' })
  phoneNumber: string;
}
