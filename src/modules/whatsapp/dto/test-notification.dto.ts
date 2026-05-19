import { IsOptional, IsString, Matches } from 'class-validator';

export class TestNotificationDto {
  @IsOptional()
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: 'Phone must be in E.164 format (e.g. +528112345678)' })
  personalPhoneNumber?: string;
}
