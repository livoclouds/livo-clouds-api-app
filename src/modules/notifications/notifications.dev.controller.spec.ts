import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { JwtPayload, UserRole } from '../../common/types';
import { EmitDevNotificationDto } from './dto/emit-dev-notification.dto';
import { NotificationsDevController } from './notifications.dev.controller';

const USER: JwtPayload = {
  sub: 'user-1',
  email: 'admin@test.local',
  role: UserRole.TENANT_ADMIN,
  condominiumId: 'cond-1',
  condominiumSlug: 'cond-slug',
};

const REQ = { condominiumId: 'cond-1' };

function dto(type: NotificationType): EmitDevNotificationDto {
  return { type } as EmitDevNotificationDto;
}

describe('NotificationsDevController', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('returns 404 in production so the endpoint is absent there', async () => {
    process.env.NODE_ENV = 'production';
    const service = {
      resolveCondominiumSlug: jest.fn(),
      createDirectForUser: jest.fn(),
    };
    const controller = new NotificationsDevController(service as never);

    await expect(
      controller.emit(REQ, USER, dto(NotificationType.IMPORT_COMPLETED)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.createDirectForUser).not.toHaveBeenCalled();
  });

  it('rejects a legacy (non-role-matrix) type with 400', async () => {
    process.env.NODE_ENV = 'development';
    const service = {
      resolveCondominiumSlug: jest.fn(),
      createDirectForUser: jest.fn(),
    };
    const controller = new NotificationsDevController(service as never);

    await expect(
      controller.emit(REQ, USER, dto('NEW_USER' as NotificationType)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.createDirectForUser).not.toHaveBeenCalled();
  });

  it('emits a real notification to the current user via createDirectForUser', async () => {
    process.env.NODE_ENV = 'development';
    const service = {
      resolveCondominiumSlug: jest.fn().mockResolvedValue('cond-slug'),
      createDirectForUser: jest
        .fn()
        .mockResolvedValue({ id: 'notif-9', type: 'IMPORT_COMPLETED' }),
    };
    const controller = new NotificationsDevController(service as never);

    const result = await controller.emit(
      REQ,
      USER,
      dto(NotificationType.IMPORT_COMPLETED),
    );

    expect(result).toEqual({ id: 'notif-9', type: 'IMPORT_COMPLETED' });
    expect(service.createDirectForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        condominiumId: 'cond-1',
        type: NotificationType.IMPORT_COMPLETED,
        // Sample reuses the production i18n keys + a placeholder-matching blob.
        title: 'notifications.types.IMPORT_COMPLETED.title',
        message: 'notifications.types.IMPORT_COMPLETED.body',
        linkUrl: '/imports/dev-batch-0001',
        data: expect.objectContaining({ rowCount: 42, currency: 'MXN' }),
      }),
    );
  });
});
