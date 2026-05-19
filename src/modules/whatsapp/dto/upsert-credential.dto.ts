import { IsString, Matches, MinLength } from 'class-validator';

export class UpsertCredentialDto {
  @IsString()
  @MinLength(1)
  phoneNumberId: string;

  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'phoneNumberDisplay must be E.164 format' })
  phoneNumberDisplay: string;

  @IsString()
  @MinLength(1)
  businessAccountId: string;

  @IsString()
  @MinLength(10)
  accessToken: string;
}
