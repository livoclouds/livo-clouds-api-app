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

describe('NotificationsController dismiss-all + sound', () => {
  const REQ = { condominiumId: 'cond-1' };

  it('dismissAll delegates to the service with tenant + user', async () => {
    const service = { dismissAll: jest.fn().mockResolvedValue({ updatedCount: 3 }) };
    const controller = new NotificationsController(service as never);
    const result = await controller.dismissAll(REQ, USER);
    expect(result).toEqual({ updatedCount: 3 });
    expect(service.dismissAll).toHaveBeenCalledWith('cond-1', 'user-1');
  });

  it('getSoundPreference delegates to the service', async () => {
    const service = {
      getSoundPreference: jest
        .fn()
        .mockResolvedValue({ soundEnabled: true, soundChoice: 'CHIME' }),
    };
    const controller = new NotificationsController(service as never);
    const result = await controller.getSoundPreference(USER);
    expect(result).toEqual({ soundEnabled: true, soundChoice: 'CHIME' });
    expect(service.getSoundPreference).toHaveBeenCalledWith('user-1');
  });

  it('updateSoundPreference forwards the DTO to the service', async () => {
    const service = {
      updateSoundPreference: jest
        .fn()
        .mockResolvedValue({ soundEnabled: false, soundChoice: 'PEBBLE', dnd: false }),
    };
    const controller = new NotificationsController(service as never);
    const dto = { soundEnabled: false, soundChoice: 'PEBBLE' } as never;
    const result = await controller.updateSoundPreference(USER, dto);
    expect(result).toEqual({ soundEnabled: false, soundChoice: 'PEBBLE', dnd: false });
    expect(service.updateSoundPreference).toHaveBeenCalledWith('user-1', dto);
  });

  it('updateDndPreference forwards the dnd flag to the service', async () => {
    const service = {
      updateDndPreference: jest.fn().mockResolvedValue({ dnd: true }),
    };
    const controller = new NotificationsController(service as never);
    const result = await controller.updateDndPreference(USER, { dnd: true } as never);
    expect(result).toEqual({ dnd: true });
    expect(service.updateDndPreference).toHaveBeenCalledWith('user-1', true);
  });
});
