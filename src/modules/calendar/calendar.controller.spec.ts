import 'reflect-metadata';
import { CalendarController } from './calendar.controller';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';

/**
 * CAL-009: the calendar read endpoints must declare @RequirePermission so that
 * revoking `calendar.read` actually blocks them (PermissionsGuard is a no-op on
 * an undecorated route). Asserted via decorator metadata — no Nest TestingModule
 * or DB needed.
 */
function requiredPerms(method: keyof CalendarController): string[] {
  return (
    Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      CalendarController.prototype[method] as object,
    ) ?? []
  );
}

describe('CalendarController — read gating (CAL-009)', () => {
  it('GET / (findAll) requires calendar.read (any-of with calendar.manage)', () => {
    expect(requiredPerms('findAll')).toEqual(['calendar.read', 'calendar.manage']);
  });

  it('GET /:id (findOne) requires calendar.read (any-of with calendar.manage)', () => {
    expect(requiredPerms('findOne')).toEqual(['calendar.read', 'calendar.manage']);
  });

  it('writes stay gated on calendar.manage', () => {
    expect(requiredPerms('create')).toEqual(['calendar.manage']);
    expect(requiredPerms('update')).toEqual(['calendar.manage']);
    expect(requiredPerms('remove')).toEqual(['calendar.manage']);
  });
});
