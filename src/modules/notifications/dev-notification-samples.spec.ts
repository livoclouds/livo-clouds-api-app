import { NotificationType } from '@prisma/client';
import { NOTIFICATION_R1_TYPES } from './notifications.constants';
import { buildDevNotificationSample } from './dev-notification-samples';
import {
  isR1NotificationType,
  type R1NotificationType,
} from './notification-role-matrix';

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('buildDevNotificationSample', () => {
  it.each(NOTIFICATION_R1_TYPES)(
    'produces production i18n keys and a data blob for %s',
    (type) => {
      const sample = buildDevNotificationSample(
        type as R1NotificationType,
        'cond-slug',
        NOW,
      );

      expect(sample.title).toBe(`notifications.types.${type}.title`);
      expect(sample.message).toBe(`notifications.types.${type}.body`);
      expect(typeof sample.data).toBe('object');
    },
  );

  it('builds a deep link from the slug for import types', () => {
    const sample = buildDevNotificationSample(
      NotificationType.IMPORT_COMPLETED,
      'cond-slug',
      NOW,
    );
    expect(sample.linkUrl).toBe(
      '/imports/dev-batch-0001',
    );
  });

  it('omits the deep link when no slug is available', () => {
    const sample = buildDevNotificationSample(
      NotificationType.IMPORT_COMPLETED,
      null,
      NOW,
    );
    expect(sample.linkUrl).toBeNull();
  });

  it('covers every role-matrix type (parity with the preferences contract)', () => {
    for (const type of NOTIFICATION_R1_TYPES) {
      expect(isR1NotificationType(type)).toBe(true);
    }
  });
});
