import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload, UserRole } from '../../common/types';
import { RbacService } from '../../common/rbac/rbac.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MoveUserDto } from './dto/move-user.dto';

/**
 * Platform-scoped user operations that intentionally cross tenant isolation —
 * e.g. a Supervisor reassigning an administrator from one condominium to another.
 * Guarded by `platform.users.manage`; never behind CondominiumAccessGuard.
 */
@Injectable()
export class PlatformUsersService {
  private readonly logger = new Logger(PlatformUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /** Move a tenant user to another condominium, reconciling their role. */
  async move(userId: string, dto: MoveUserDto, requester: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        condominiumId: true,
        roleId: true,
        roleRef: { select: { key: true, isSystem: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // ROOT / platform users are global (no condominium) — never scope to one.
    if (user.roleRef?.key === UserRole.ROOT || user.condominiumId === null) {
      throw new ForbiddenException('Cannot move a platform (ROOT) user');
    }
    if (user.condominiumId === dto.condominiumId) {
      throw new BadRequestException('User already belongs to that condominium');
    }

    const target = await this.prisma.condominium.findFirst({
      where: { id: dto.condominiumId, isActive: true },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Target condominium not found');

    // Resolve the role for the destination.
    let roleId = user.roleId;
    if (dto.roleId) {
      const role = await this.prisma.role.findFirst({
        where: {
          id: dto.roleId,
          isActive: true,
          deletedAt: null,
          // A global system role, or a custom role of the DESTINATION condo.
          OR: [{ isSystem: true }, { condominiumId: dto.condominiumId }],
        },
        select: { id: true },
      });
      if (!role) throw new NotFoundException('Role not found for destination');
      roleId = role.id;
    } else if (user.roleRef && !user.roleRef.isSystem) {
      // The current role is a custom role scoped to the SOURCE condominium and
      // is not valid in the destination — reset to the system Administrator role.
      const admin = await this.prisma.role.findFirst({
        where: { key: UserRole.TENANT_ADMIN, isSystem: true },
        select: { id: true },
      });
      roleId = admin?.id ?? null;
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { condominiumId: dto.condominiumId, roleId },
        select: { id: true, condominiumId: true, roleId: true },
      });
      // The user's tenant + role changed — drop cached effective permissions.
      this.rbac.invalidateUser(userId);

      // Best-effort audit (a platform action crossing tenant isolation).
      try {
        await this.audit.log({
          userId: requester.sub,
          condominiumId: dto.condominiumId,
          action: 'PLATFORM_USER_MOVED',
          actionCategory: 'USER',
          module: 'platform-users',
          entityType: 'User',
          entityId: userId,
          beforeState: {
            condominiumId: user.condominiumId,
            roleId: user.roleId,
          },
          afterState: {
            condominiumId: updated.condominiumId,
            roleId: updated.roleId,
          },
          result: 'SUCCESS',
          description: 'User moved between condominiums',
        });
      } catch (err) {
        this.logger.warn(`audit(PLATFORM_USER_MOVED) failed: ${String(err)}`);
      }

      return updated;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user with this email already exists in the destination condominium',
        );
      }
      throw err;
    }
  }
}
