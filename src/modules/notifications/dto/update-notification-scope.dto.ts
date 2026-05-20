import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RootScope } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateNotificationScopeDto {
  @ApiProperty({ enum: RootScope })
  @IsEnum(RootScope)
  scope!: RootScope;

  @ApiPropertyOptional({
    isArray: true,
    type: String,
    description:
      'Condominium ids to scope ROOT notifications to. Required (non-empty) ' +
      'when scope is SPECIFIC; ignored when scope is ACTIVE_TENANT or ALL.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  condominiumIds?: string[];
}
