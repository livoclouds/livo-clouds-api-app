import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtPayload, UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { UpdateCondominiumDto } from './dto/update-condominium.dto';

@Injectable()
export class CondominiumsService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: JwtPayload) {
    const where =
      user.role === UserRole.ROOT
        ? {}
        : { id: user.condominiumId ?? undefined };

    return this.prisma.condominium.findMany({
      where,
      include: { settings: true },
      orderBy: { name: 'asc' },
    });
  }

  async findBySlug(slug: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { slug },
      include: { settings: true },
    });

    if (!condo) {
      throw new NotFoundException(`Condominium "${slug}" not found`);
    }

    return condo;
  }

  async findById(id: string) {
    const condo = await this.prisma.condominium.findUnique({
      where: { id },
      include: { settings: true },
    });

    if (!condo) {
      throw new NotFoundException(`Condominium not found`);
    }

    return condo;
  }

  async create(dto: CreateCondominiumDto) {
    const existing = await this.prisma.condominium.findUnique({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(`Slug "${dto.slug}" is already taken`);
    }

    return this.prisma.condominium.create({
      data: {
        ...dto,
        settings: { create: {} },
      },
      include: { settings: true },
    });
  }

  async update(id: string, dto: UpdateCondominiumDto) {
    await this.findById(id);

    if (dto.slug) {
      const slugConflict = await this.prisma.condominium.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (slugConflict) {
        throw new ConflictException(`Slug "${dto.slug}" is already taken`);
      }
    }

    return this.prisma.condominium.update({
      where: { id },
      data: dto,
      include: { settings: true },
    });
  }

  async remove(id: string) {
    await this.findById(id);

    return this.prisma.condominium.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
