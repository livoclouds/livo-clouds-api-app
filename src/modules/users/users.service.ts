import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { JwtPayload, UserRole } from '../../common/types';
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
  ) {}

  /** Best-effort notification emit — never breaks the user write. */
  private emitNotification(event: string, payload: object): void {
    try {
      this.events.emit(event, payload);
    } catch (err) {
      this.logger.warn(`emitNotification(${event}) failed: ${String(err)}`);
    }
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
    if (requester.role === UserRole.TENANT_ADMIN && dto.role === UserRole.ROOT) {
      throw new ForbiddenException('Cannot create a ROOT user');
    }

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

    const user = await this.prisma.user.create({
      data: {
        condominiumId,
        email: dto.email,
        passwordHash,
        role: dto.role,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
        sessionDuration: dto.sessionDuration ?? 8,
      },
      select: this.safeSelect(),
    });

    this.emitNotification(USER_ADDED_EVENT, {
      condominiumId,
      userId: user.id,
      email: user.email,
      role: user.role,
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

    if (requester.role === UserRole.TENANT_ADMIN && dto.role === UserRole.ROOT) {
      throw new ForbiddenException('Cannot assign ROOT role');
    }

    const updateData: Record<string, unknown> = { ...dto };

    if (dto.password) {
      updateData.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      delete updateData.password;
    }

    const result = await this.prisma.user.updateMany({
      where: { id, condominiumId, deletedAt: null },
      data: updateData,
    });
    if (result.count === 0) throw new NotFoundException('User not found');
    const after = await this.prisma.user.findFirst({
      where: { id, condominiumId, deletedAt: null },
      select: this.safeSelect(),
    });

    // Notify only when the role genuinely changed — a name/phone edit is not
    // a permissions change.
    if (after && before.role !== after.role) {
      this.emitNotification(USER_PERMISSIONS_CHANGED_EVENT, {
        condominiumId,
        userId: id,
        beforeRole: before.role,
        afterRole: after.role,
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
    return this.prisma.user.findFirst({
      where: { id, condominiumId },
      select: this.safeSelect(),
    });
  }

  private safeSelect() {
    return {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      sessionDuration: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}
