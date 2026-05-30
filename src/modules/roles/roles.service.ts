import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  sanitizePermissions,
  unknownPermissions,
} from '../../common/rbac/permission-catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  private roleSelect() {
    return {
      id: true,
      key: true,
      name: true,
      description: true,
      isSystem: true,
      isActive: true,
      condominiumId: true,
      permissions: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  /** System roles (global) + this condominium's custom roles. */
  async findAll(condominiumId: string) {
    const roles = await this.prisma.role.findMany({
      where: {
        deletedAt: null,
        OR: [{ isSystem: true }, { condominiumId }],
      },
      select: this.roleSelect(),
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    // Attach assigned-user counts so the UI can warn before deletion.
    const counts = await this.prisma.user.groupBy({
      by: ['roleId'],
      where: { deletedAt: null, roleId: { in: roles.map((r) => r.id) } },
      _count: { _all: true },
    });
    const countByRole = new Map(
      counts.map((c) => [c.roleId, c._count._all]),
    );
    return roles.map((r) => ({ ...r, userCount: countByRole.get(r.id) ?? 0 }));
  }

  async findOne(condominiumId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [{ isSystem: true }, { condominiumId }],
      },
      select: this.roleSelect(),
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  /** Validate catalog keys; reject unknowns so the caller gets clear feedback. */
  private validatePermissions(permissions: string[]): string[] {
    const unknown = unknownPermissions(permissions);
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}`,
      );
    }
    return sanitizePermissions(permissions);
  }

  async create(condominiumId: string, dto: CreateRoleDto) {
    const permissions = this.validatePermissions(dto.permissions);
    try {
      return await this.prisma.role.create({
        data: {
          name: dto.name,
          description: dto.description,
          permissions,
          isSystem: false,
          isActive: true,
          condominiumId,
        },
        select: this.roleSelect(),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A role with that name already exists');
      }
      throw err;
    }
  }

  async update(condominiumId: string, id: string, dto: UpdateRoleDto) {
    const existing = await this.prisma.role.findFirst({
      where: { id, deletedAt: null, OR: [{ isSystem: true }, { condominiumId }] },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem) {
      throw new ForbiddenException('System roles cannot be modified');
    }

    const data: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.permissions !== undefined) {
      data.permissions = this.validatePermissions(dto.permissions);
    }

    try {
      return await this.prisma.role.update({
        where: { id },
        data,
        select: this.roleSelect(),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A role with that name already exists');
      }
      throw err;
    }
  }

  async remove(condominiumId: string, id: string) {
    const existing = await this.prisma.role.findFirst({
      where: { id, deletedAt: null, OR: [{ isSystem: true }, { condominiumId }] },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted');
    }

    const assigned = await this.prisma.user.count({
      where: { roleId: id, deletedAt: null },
    });
    if (assigned > 0) {
      throw new ConflictException(
        'Role is assigned to users; reassign them before deleting',
      );
    }

    return this.prisma.role.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: this.roleSelect(),
    });
  }
}
