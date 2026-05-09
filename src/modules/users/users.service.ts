import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtPayload, UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    return this.prisma.user.create({
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
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateUserDto,
    requester: JwtPayload,
  ) {
    await this.findOne(condominiumId, id);

    if (requester.role === UserRole.TENANT_ADMIN && dto.role === UserRole.ROOT) {
      throw new ForbiddenException('Cannot assign ROOT role');
    }

    const updateData: Record<string, unknown> = { ...dto };

    if (dto.password) {
      updateData.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      delete updateData.password;
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: this.safeSelect(),
    });
  }

  async remove(condominiumId: string, id: string) {
    await this.findOne(condominiumId, id);

    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
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
