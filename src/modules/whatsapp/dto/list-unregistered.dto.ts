import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { WhatsAppUnregisteredContactStatus } from '@prisma/client';

export class ListUnregisteredDto {
  @IsOptional()
  @IsEnum(WhatsAppUnregisteredContactStatus)
  status?: WhatsAppUnregisteredContactStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minConversationCount?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
