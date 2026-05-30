import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
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
}
