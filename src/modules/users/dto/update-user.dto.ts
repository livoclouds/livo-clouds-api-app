import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['email'] as const)) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Dynamic RBAC: assign a Role row (system or this condominium's custom role).
  // Reconciled with the legacy `role` enum server-side. See UsersService.update.
  @ApiPropertyOptional({ description: 'Assigned Role id (dynamic RBAC)' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  // Per-user permission overrides (RBAC Phase 3). `null` resets to inheriting the
  // assigned role; an array is the explicit effective set (sanitised against the
  // catalog server-side). `undefined` (key absent) leaves overrides unchanged.
  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'Effective permission keys for this user; null = inherit the role',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @IsString({ each: true })
  permissionOverrides?: string[] | null;
}
