import { JwtPayload, UserRole } from '../../common/types';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationsController } from './notifications.controller';

const USER: JwtPayload = {
  sub: 'user-1',
  email: 'admin@test.local',
  role: UserRole.TENANT_ADMIN,
  condominiumId: 'cond-1',
  condominiumSlug: 'cond-slug',
};

describe('NotificationsController inbox endpoint', () => {
  it('returns the documented inbox payload shape', async () => {
    const serviceMock = {
      list: jest.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        unreadCount: 0,
      }),
    };
    const controller = new NotificationsController(serviceMock as never);

    const result = await controller.list(
      { condominiumId: 'cond-1' },
      USER,
      {} as ListNotificationsDto,
    );

    // The ResponseInterceptor adds the outer { data } envelope at runtime;
    // the handler itself returns exactly the inner payload below.
    expect(result).toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      unreadCount: 0,
    });
    expect(Object.keys(result).sort()).toEqual([
      'items',
      'limit',
      'page',
      'total',
      'unreadCount',
    ]);
    expect(serviceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        condominiumId: 'cond-1',
        page: 1,
        limit: 20,
      }),
    );
  });
});
