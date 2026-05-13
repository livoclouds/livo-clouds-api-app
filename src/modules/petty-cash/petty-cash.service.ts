import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';

const MAX_FOLIO_RETRIES = 5;

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

    for (let attempt = 0; attempt < MAX_FOLIO_RETRIES; attempt++) {
      const count = await this.prisma.pettyCashMovement.count({
        where: { condominiumId },
      });
      const folio = `PC-${String(count + 1 + attempt).padStart(4, '0')}`;

      try {
        return await this.prisma.pettyCashMovement.create({
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
      } catch (err) {
        const isUniqueFolioViolation =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          Array.isArray(err.meta?.target) &&
          (err.meta!.target as string[]).includes('folio');
        if (!isUniqueFolioViolation) throw err;
      }
    }

    throw new ConflictException(
      'Could not generate unique folio after retries',
    );
  }

  async approve(condominiumId: string, id: string, userId: string) {
    const movement = await this.findOne(condominiumId, id);

    if (movement.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING movements can be approved');
    }

    const result = await this.prisma.pettyCashMovement.updateMany({
      where: { id, condominiumId },
      data: { status: 'APPROVED', updatedById: userId },
    });
    if (result.count === 0) throw new NotFoundException('Movement not found');
    return this.findOne(condominiumId, id);
  }

  async reject(condominiumId: string, id: string, userId: string) {
    const movement = await this.findOne(condominiumId, id);

    if (movement.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING movements can be rejected');
    }

    const result = await this.prisma.pettyCashMovement.updateMany({
      where: { id, condominiumId },
      data: { status: 'REJECTED', updatedById: userId },
    });
    if (result.count === 0) throw new NotFoundException('Movement not found');
    return this.findOne(condominiumId, id);
  }
}
