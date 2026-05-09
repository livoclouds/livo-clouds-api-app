import { Injectable } from '@nestjs/common';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(condominiumId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: {
        condominiumId,
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(condominiumId: string, id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, condominiumId, OR: [{ userId }, { userId: null }] },
      data: { isRead: true },
    });
  }

  async markAllRead(condominiumId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        condominiumId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true },
    });
  }
}
