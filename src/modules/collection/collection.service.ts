import { Injectable, NotFoundException } from '@nestjs/common';
import { CollectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CollectionService {
  constructor(private prisma: PrismaService) {}

  async findAll(condominiumId: string, year: number) {
    return this.prisma.collectionRecord.findMany({
      where: { condominiumId, year },
      include: {
        resident: {
          select: { id: true, unitNumber: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ month: 'asc' }],
    });
  }

  async findByResident(condominiumId: string, residentId: string) {
    return this.prisma.collectionRecord.findMany({
      where: { condominiumId, residentId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async update(
    condominiumId: string,
    id: string,
    dto: {
      status?: string;
      amountPaid?: number;
      paymentDate?: string;
      notes?: string;
    },
  ) {
    const record = await this.prisma.collectionRecord.findFirst({
      where: { id, condominiumId },
    });

    if (!record) {
      throw new NotFoundException('Collection record not found');
    }

    return this.prisma.collectionRecord.update({
      where: { id },
      data: {
        status: dto.status ? (dto.status as CollectionStatus) : undefined,
        amountPaid: dto.amountPaid,
        notes: dto.notes,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
      },
    });
  }
}
