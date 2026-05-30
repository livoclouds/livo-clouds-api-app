import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Payload for moving a user to another condominium (RBAC Phase 3, platform op).
 */
export class MoveUserDto {
  @ApiProperty({ description: 'Destination condominium id' })
  @IsUUID()
  condominiumId: string;

  // Optional explicit role for the destination. If omitted: a system role is
  // kept as-is (system roles are global); a custom role — scoped to the SOURCE
  // condominium — is reset to the system Administrator (TENANT_ADMIN) role.
  @ApiPropertyOptional({ description: 'Role id to assign at the destination' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
