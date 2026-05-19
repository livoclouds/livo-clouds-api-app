import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateBotConfigDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  fallbackMessage?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  escalationMessage?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  offHoursMessage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  escalationKeywords?: string[];

  @IsOptional()
  @IsBoolean()
  identityCaptureEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  identityCapturePrompt?: string;

  @IsOptional()
  @IsBoolean()
  whitelistEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @Matches(/^\+\d{10,15}$/, { each: true, message: 'Each phone must be E.164 format' })
  whitelistedPhoneNumbers?: string[];

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  conversationRetentionDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  returnToBotMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  beRightWithYouMessage?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  reNotifyAfterMinutes?: number;
}
