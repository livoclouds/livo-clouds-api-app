import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../rbac/rbac.service';
import { PermissionsGuard } from './permissions.guard';

function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Cls {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let rbac: { hasAny: jest.Mock };
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    rbac = { hasAny: jest.fn() };
    guard = new PermissionsGuard(
      reflector as unknown as Reflector,
      rbac as unknown as RbacService,
    );
  });

  it('is a no-op (allows) when the route has no @RequirePermission', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(rbac.hasAny).not.toHaveBeenCalled();
  });

  it('allows when an empty permission array is set', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(rbac.hasAny).not.toHaveBeenCalled();
  });

  it('allows when the user holds a required permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.manage']);
    rbac.hasAny.mockResolvedValue(true);
    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(rbac.hasAny).toHaveBeenCalledWith('u1', ['users.manage']);
  });

  it('denies (403) when the user lacks every required permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.manage']);
    rbac.hasAny.mockResolvedValue(false);
    await expect(
      guard.canActivate(makeContext({ sub: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies (403) when there is no authenticated user', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.manage']);
    await expect(
      guard.canActivate(makeContext(undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rbac.hasAny).not.toHaveBeenCalled();
  });
});
