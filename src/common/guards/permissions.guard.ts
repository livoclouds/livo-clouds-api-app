import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { RbacService } from '../rbac/rbac.service';
import { JwtPayload } from '../types';

/**
 * Global permission enforcement (RBAC Phase 2). Runs after JwtAuthGuard so
 * request.user is populated. It is a NO-OP for routes without @RequirePermission,
 * so it can be rolled out incrementally alongside the legacy @Roles guard.
 *
 * For gated routes it checks the user's effective permissions (resolved live +
 * cached by RbacService) against the required keys (any-of). Developer (ROOT)
 * naturally passes everything since its preset is the full catalog — no special
 * casing needed. Tenant isolation stays with CondominiumAccessGuard.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true; // not permission-gated

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user?.sub) {
      throw new ForbiddenException('Access denied');
    }

    const allowed = await this.rbac.hasAny(user.sub, required);
    if (!allowed) {
      throw new ForbiddenException(
        `Missing required permission: ${required.join(' | ')}`,
      );
    }
    return true;
  }
}
