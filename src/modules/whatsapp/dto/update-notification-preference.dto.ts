import { WhatsAppNotifyChannel } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  notifyOnEscalation?: boolean;

  @IsOptional()
  @IsEnum(WhatsAppNotifyChannel)
  notifyChannel?: WhatsAppNotifyChannel;

  @IsOptional()
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'Phone must be in E.164 format (e.g. +528112345678)' })
  personalPhoneNumber?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  reNotifyAfterMinutes?: number | null;
}
