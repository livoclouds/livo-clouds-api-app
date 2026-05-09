import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload, UserRole } from '../types';

@Injectable()
export class CondominiumAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    const slug =
      request.params?.condominiumSlug || request.params?.slug;

    if (!slug) {
      return true;
    }

    const condominium = await this.prisma.condominium.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });

    if (!condominium) {
      throw new NotFoundException(`Condominium "${slug}" not found`);
    }

    if (!condominium.isActive) {
      throw new ForbiddenException('Condominium is inactive');
    }

    request.condominiumId = condominium.id;

    if (user.role === UserRole.ROOT) {
      return true;
    }

    if (user.condominiumId !== condominium.id) {
      throw new ForbiddenException(
        'You do not have access to this condominium',
      );
    }

    return true;
  }
}
