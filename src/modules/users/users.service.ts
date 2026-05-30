import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtPayload, UserRole } from '../../common/types';
import { RbacService } from '../../common/rbac/rbac.service';
import { isPlatformPermission, sanitizePermissions } from '../../common/rbac/permission-catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  USER_ADDED_EVENT,
  USER_PERMISSIONS_CHANGED_EVENT,
  type UserAddedEventPayload,
  type UserPermissionsChangedEventPayload,
} from './events/user-notification-events';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly rbac: RbacService,
  ) {}

  /** Best-effort notification emit — never breaks the user write. */
  private emitNotification(event: string, payload: object): void {
    try {
      this.events.emit(event, payload);
    } catch (err) {
      this.logger.warn(`emitNotification(${event}) failed: ${String(err)}`);
    }
  }

  private async assertCanSetPermissionOverrides(
    requester: JwtPayload,
    overrides: string[] | null | undefined,
  ): Promise<void> {
    // Gate 1: any override mutation (even null) requires users.permissions.manage.
    // Only ROOT holds this key in the default presets.
    const canManage = await this.rbac.hasAny(requester.sub, ['users.permissions.manage']);
    if (!canManage) throw new ForbiddenException('Requires users.permissions.manage');

    // Unknown keys will be dropped by sanitizePermissions before storage — only
    // check valid catalog keys so gates 2 and 3 apply to real capability grants.
    const valid = Array.isArray(overrides) ? sanitizePermissions(overrides) : null;
    if (!valid || valid.length === 0) return;

    const requesterPerms = await this.rbac.getEffectivePermissions(requester.sub);

    // Gate 2: tenant-scoped actors cannot grant platform-wide capabilities.
    if (valid.some((k) => isPlatformPermission(k))) {
      const hasPlatformAccess = [...requesterPerms].some((k) => isPlatformPermission(k));
      if (!hasPlatformAccess)
        throw new ForbiddenException('Cannot grant platform-scoped permissions');
    }

    // Gate 3: cap grants to the actor's own effective permissions.
    const unowned = valid.filter((k) => !requesterPerms.has(k));
    if (unowned.length > 0)
      throw new ForbiddenException('Cannot grant permissions you do not hold');
  }

  private async assertCanAssignRole(
    requester: JwtPayload,
    roleKey: string | null,
  ): Promise<void> {
    if (roleKey !== UserRole.ROOT) return;
    const allowed = await this.rbac.hasAny(requester.sub, ['platform.users.manage']);
    if (!allowed) throw new ForbiddenException('Cannot assign ROOT role');
  }

  async findAll(condominiumId: string) {
    return this.prisma.user.findMany({
      where: { condominiumId, deletedAt: null },
      select: this.safeSelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(condominiumId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, condominiumId, deletedAt: null },
      select: this.safeSelect(),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(condominiumId: string, dto: CreateUserDto, requester: JwtPayload) {
    await this.assertCanAssignRole(requester, dto.role);

    // ROOT users require globally unique emails (condominiumId is null, DB constraint doesn't enforce it)
    const emailWhere =
      dto.role === UserRole.ROOT
        ? { email: dto.email, deletedAt: null }
        : { email: dto.email, condominiumId, deletedAt: null };

    const existing = await this.prisma.user.findFirst({ where: emailWhere });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // Resolve the requested role KEY to its system Role row — the single source
    // of truth (the legacy `role` enum column was removed in RBAC Phase 2).
    const systemRole = await this.prisma.role.findFirst({
      where: { key: dto.role, isSystem: true },
      select: { id: true },
    });

    const user = await this.prisma.user.create({
      data: {
        condominiumId,
        email: dto.email,
        passwordHash,
        roleId: systemRole?.id ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
        sessionDuration: dto.sessionDuration ?? 8,
        inactivityLockMinutes: dto.inactivityLockMinutes ?? 15,
      },
      select: this.safeSelect(),
    });

    this.emitNotification(USER_ADDED_EVENT, {
      condominiumId,
      userId: user.id,
      email: user.email,
      role: user.roleRef?.key ?? '',
      actorUserId: requester.sub,
    } satisfies UserAddedEventPayload);

    return user;
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateUserDto,
    requester: JwtPayload,
  ) {
    const before = await this.findOne(condominiumId, id);

    const updateData: Record<string, unknown> = { ...dto };

    if (dto.password) {
      updateData.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      delete updateData.password;
    }

    // Dynamic RBAC role assignment. Accepts either an explicit roleId or a role
    // KEY (the web sends the key); both resolve to a validated roleId — the only
    // role field now persisted. Never let the raw dto values through unvalidated.
    delete updateData.roleId;
    delete updateData.role;
    const assignment = await this.resolveRoleAssignment(
      condominiumId,
      dto,
      requester,
    );
    Object.assign(updateData, assignment);

    // Per-user permission overrides (RBAC Phase 3). `null` resets to inheriting
    // the role (DB NULL); an array is sanitised against the catalog; an absent
    // key leaves overrides unchanged. The unconditional cache invalidation below
    // makes the new effective set apply on the next request (no re-login).
    if ('permissionOverrides' in dto) {
      await this.assertCanSetPermissionOverrides(requester, dto.permissionOverrides);
      updateData.permissionOverrides =
        dto.permissionOverrides == null
          ? Prisma.DbNull
          : sanitizePermissions(dto.permissionOverrides);
    }

    const result = await this.prisma.user.updateMany({
      where: { id, condominiumId, deletedAt: null },
      data: updateData,
    });
    if (result.count === 0) throw new NotFoundException('User not found');
    // The role/permissions may have changed — drop the cached effective set so
    // the next request re-resolves (no re-login needed).
    this.rbac.invalidateUser(id);
    const after = await this.prisma.user.findFirst({
      where: { id, condominiumId, deletedAt: null },
      select: this.safeSelect(),
    });

    // Notify only when the role genuinely changed — a name/phone edit is not
    // a permissions change.
    if (after && before.roleRef?.key !== after.roleRef?.key) {
      this.emitNotification(USER_PERMISSIONS_CHANGED_EVENT, {
        condominiumId,
        userId: id,
        beforeRole: before.roleRef?.key ?? '',
        afterRole: after.roleRef?.key ?? '',
        actorUserId: requester.sub,
      } satisfies UserPermissionsChangedEventPayload);
    }

    return after;
  }

  async remove(condominiumId: string, id: string) {
    const result = await this.prisma.user.updateMany({
      where: { id, condominiumId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0) throw new NotFoundException('User not found');
    this.rbac.invalidateUser(id);
    return this.prisma.user.findFirst({
      where: { id, condominiumId },
      select: this.safeSelect(),
    });
  }

  /**
   * Resolve the role assignment from an update DTO to a validated `roleId` — the
   * only role field persisted. An explicit `roleId` wins; otherwise a role KEY
   * (`dto.role`, what the web sends) is mapped to its system Role row.
   */
  private async resolveRoleAssignment(
    condominiumId: string,
    dto: UpdateUserDto,
    requester: JwtPayload,
  ): Promise<{ roleId?: string }> {
    if (dto.roleId !== undefined && dto.roleId !== null) {
      const role = await this.prisma.role.findFirst({
        where: {
          id: dto.roleId,
          isActive: true,
          deletedAt: null,
          // Assignable: a global system role, or a custom role of this condominium.
          OR: [{ isSystem: true }, { condominiumId }],
        },
        select: { id: true, key: true },
      });
      if (!role) throw new NotFoundException('Role not found');
      await this.assertCanAssignRole(requester, role.key);
      return { roleId: role.id };
    }

    if (dto.role !== undefined) {
      await this.assertCanAssignRole(requester, dto.role);
      const sys = await this.prisma.role.findFirst({
        where: { key: dto.role, isSystem: true },
        select: { id: true },
      });
      if (!sys) throw new NotFoundException('Role not found');
      return { roleId: sys.id };
    }

    return {};
  }

  private safeSelect() {
    return {
      id: true,
      email: true,
      roleId: true,
      roleRef: {
        select: {
          id: true,
          key: true,
          name: true,
          isSystem: true,
          permissions: true,
        },
      },
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      sessionDuration: true,
      inactivityLockMinutes: true,
      isActive: true,
      permissionOverrides: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}
