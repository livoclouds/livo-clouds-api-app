import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

@Injectable()
export class PettyCashService {
  constructor(private prisma: PrismaService) {}

  async findAll(condominiumId: string) {
    return this.prisma.pettyCashMovement.findMany({
      where: { condominiumId },
      include: {
        registeredBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(condominiumId: string, id: string) {
    const movement = await this.prisma.pettyCashMovement.findFirst({
      where: { id, condominiumId },
      include: {
        registeredBy: { select: { id: true, firstName: true, lastName: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException('Movement not found');
    }

    return movement;
  }

  async create(condominiumId: string, dto: CreateMovementDto, user: JwtPayload) {
    const lastMovement = await this.prisma.pettyCashMovement.findFirst({
      where: { condominiumId },
      orderBy: { createdAt: 'desc' },
      select: { runningBalance: true },
    });

    const prevBalance = Number(lastMovement?.runningBalance ?? 0);
    const isExit =
      dto.movementType === 'EXIT' || dto.movementType === 'REIMBURSEMENT';
    const runningBalance = isExit
      ? prevBalance - dto.amount
      : prevBalance + dto.amount;

    const count = await this.prisma.pettyCashMovement.count({
      where: { condominiumId },
    });
    const folio = `PC-${String(count + 1).padStart(4, '0')}`;

    return this.prisma.pettyCashMovement.create({
      data: {
        condominiumId,
        folio,
        date: new Date(dto.date),
        movementType: dto.movementType,
        category: dto.category,
        concept: dto.concept,
        amount: dto.amount,
        runningBalance,
        deliveryMethod: dto.deliveryMethod,
        responsible: dto.responsible,
        supplier: dto.supplier,
        hasReceipt: dto.hasReceipt ?? false,
        receiptNumber: dto.receiptNumber,
        authorizedBy: dto.authorizedBy,
        notes: dto.notes,
        registeredById: user.sub,
      },
    });
  }

  async approve(condominiumId: string, id: string, userId: string) {
    const movement = await this.findOne(condominiumId, id);

    if (movement.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING movements can be approved');
    }

    return this.prisma.pettyCashMovement.update({
      where: { id },
      data: { status: 'APPROVED', updatedById: userId },
    });
  }

  async reject(condominiumId: string, id: string, userId: string) {
    const movement = await this.findOne(condominiumId, id);

    if (movement.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING movements can be rejected');
    }

    return this.prisma.pettyCashMovement.update({
      where: { id },
      data: { status: 'REJECTED', updatedById: userId },
    });
  }
}
