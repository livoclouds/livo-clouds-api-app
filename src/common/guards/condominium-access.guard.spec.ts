import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../types';
import { CondominiumAccessGuard } from './condominium-access.guard';

const CONDOMINIUM_ID = 'condo-1';

function makeContext(
  user: unknown,
  params: Record<string, string> = {},
): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { user, params };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Cls {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('CondominiumAccessGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { condominium: { findUnique: jest.Mock } };
  let guard: CondominiumAccessGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    prisma = { condominium: { findUnique: jest.fn() } };
    guard = new CondominiumAccessGuard(
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    );
  });

  it('resolves the tenant and allows a member of the condominium', async () => {
    prisma.condominium.findUnique.mockResolvedValue({
      id: CONDOMINIUM_ID,
      isActive: true,
    });
    const { context, request } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: CONDOMINIUM_ID },
      { condominiumSlug: 'cotoalameda' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.condominiumId).toBe(CONDOMINIUM_ID);
  });

  it('throws 404 for an unknown slug', async () => {
    prisma.condominium.findUnique.mockResolvedValue(null);
    const { context } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: CONDOMINIUM_ID },
      { condominiumSlug: 'nope' },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 403 for an inactive condominium', async () => {
    prisma.condominium.findUnique.mockResolvedValue({
      id: CONDOMINIUM_ID,
      isActive: false,
    });
    const { context } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: CONDOMINIUM_ID },
      { condominiumSlug: 'cotoalameda' },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ROOT into any condominium', async () => {
    prisma.condominium.findUnique.mockResolvedValue({
      id: CONDOMINIUM_ID,
      isActive: true,
    });
    const { context } = makeContext(
      { role: UserRole.ROOT, condominiumId: 'other-condo' },
      { condominiumSlug: 'cotoalameda' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws 403 for a member of a different condominium', async () => {
    prisma.condominium.findUnique.mockResolvedValue({
      id: CONDOMINIUM_ID,
      isActive: true,
    });
    const { context } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: 'other-condo' },
      { condominiumSlug: 'cotoalameda' },
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to the :slug param for condominium routes', async () => {
    prisma.condominium.findUnique.mockResolvedValue({
      id: CONDOMINIUM_ID,
      isActive: true,
    });
    const { context, request } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: CONDOMINIUM_ID },
      { slug: 'cotoalameda' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.condominium.findUnique).toHaveBeenCalledWith({
      where: { slug: 'cotoalameda' },
      select: { id: true, isActive: true },
    });
    expect(request.condominiumId).toBe(CONDOMINIUM_ID);
  });

  // ENGINE-057: a slug-less route must fail closed — proceeding with
  // request.condominiumId undefined would let Prisma drop the tenant filter.
  it('ENGINE-057: throws 403 when the route has no slug param and no opt-out', async () => {
    const { context } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: CONDOMINIUM_ID },
      {},
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.condominium.findUnique).not.toHaveBeenCalled();
  });

  it('ENGINE-057: allows a slug-less route that opts out via @SkipCondominiumScope', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context, request } = makeContext(
      { role: UserRole.TENANT_ADMIN, condominiumId: CONDOMINIUM_ID },
      {},
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.condominium.findUnique).not.toHaveBeenCalled();
    expect(request.condominiumId).toBeUndefined();
  });

  // The opt-out is evaluated BEFORE slug extraction: support-article routes
  // carry an article :slug the guard must never misread as a condominium slug.
  it('ENGINE-057: opt-out skips tenant resolution even when a :slug param exists', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = makeContext(
      { role: UserRole.RESIDENT, condominiumId: CONDOMINIUM_ID },
      { slug: 'getting-started' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.condominium.findUnique).not.toHaveBeenCalled();
  });
});
