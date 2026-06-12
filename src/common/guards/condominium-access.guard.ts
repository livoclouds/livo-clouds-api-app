import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_CONDOMINIUM_SCOPE } from '../decorators/skip-condominium-scope.decorator';
import { JwtPayload, UserRole } from '../types';

@Injectable()
export class CondominiumAccessGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ENGINE-057: routes that are not condominium-scoped must say so
    // explicitly. The opt-out is checked before slug extraction because a
    // route may carry a `:slug` param that is not a condominium slug
    // (e.g. support-article metrics).
    const skipScope = this.reflector.getAllAndOverride<boolean>(
      SKIP_CONDOMINIUM_SCOPE,
      [context.getHandler(), context.getClass()],
    );
    if (skipScope) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    const slug =
      request.params?.condominiumSlug || request.params?.slug;

    if (!slug) {
      // ENGINE-057: fail closed. Proceeding with an unresolved tenant leaves
      // `request.condominiumId` undefined, and Prisma silently drops an
      // undefined `condominiumId` filter — matching every tenant's rows.
      throw new ForbiddenException(
        'Condominium scope is required for this route',
      );
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
