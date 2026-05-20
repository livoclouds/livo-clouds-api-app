import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { WhatsAppUnregisteredContactStatus } from '@prisma/client';

export class UpdateUnregisteredContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  capturedUnitNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  capturedName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(WhatsAppUnregisteredContactStatus)
  status?: WhatsAppUnregisteredContactStatus;
}
