import { UnauthorizedException } from '@nestjs/common';
import { WhatsAppInternalCronController } from './whatsapp-internal-cron.controller';

function setup(secret: string | undefined = 'test-secret-32-chars-abcdefghijkl') {
  const configService = {
    get: jest.fn().mockImplementation((key: string, fallback: string) => {
      if (key === 'CRON_SECRET') return secret ?? fallback;
      return fallback;
    }),
  };
  const renotify = {
    scanAndReNotify: jest.fn().mockResolvedValue({ scanned: 3, dispatched: 2 }),
  };
  const controller = new WhatsAppInternalCronController(
    configService as never,
    renotify as never,
  );
  return { controller, configService, renotify };
}

describe('WhatsAppInternalCronController.renotifyEndpoint', () => {
  it('rejects when authorization header is missing', async () => {
    const { controller, renotify } = setup();
    await expect(controller.renotifyEndpoint(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(renotify.scanAndReNotify).not.toHaveBeenCalled();
  });

  it('rejects when authorization header lacks Bearer prefix', async () => {
    const { controller, renotify } = setup();
    await expect(
      controller.renotifyEndpoint('test-secret-32-chars-abcdefghijkl'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(renotify.scanAndReNotify).not.toHaveBeenCalled();
  });

  it('rejects when bearer token does not match CRON_SECRET', async () => {
    const { controller, renotify } = setup();
    await expect(
      controller.renotifyEndpoint('Bearer wrong-secret-32-chars-abcdefghi'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(renotify.scanAndReNotify).not.toHaveBeenCalled();
  });

  it('rejects when CRON_SECRET is not configured at all', async () => {
    const { controller, renotify } = setup('');
    await expect(
      controller.renotifyEndpoint('Bearer test-secret-32-chars-abcdefghijkl'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(renotify.scanAndReNotify).not.toHaveBeenCalled();
  });

  it('accepts request with matching bearer token and returns scan result', async () => {
    const { controller, renotify } = setup();
    const result = await controller.renotifyEndpoint(
      'Bearer test-secret-32-chars-abcdefghijkl',
    );
    expect(result).toEqual({ ok: true, scanned: 3, dispatched: 2 });
    expect(renotify.scanAndReNotify).toHaveBeenCalledTimes(1);
  });

  it('uses timing-safe comparison (different length tokens rejected without throw)', async () => {
    const { controller, renotify } = setup('long-secret');
    await expect(controller.renotifyEndpoint('Bearer short')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(renotify.scanAndReNotify).not.toHaveBeenCalled();
  });
});
