import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCalendarEventDto } from './create-calendar-event.dto';
import { UpdateCalendarEventDto } from './update-calendar-event.dto';

// CAL-024: every free-text field must carry a @MaxLength cap so a multi-MB string
// under the 40MB Fastify bodyLimit can no longer inflate rows, list payloads and
// CSV exports. These specs assert the caps via class-validator directly.

const VALID_BASE = {
  title: 'Asamblea',
  eventType: 'GENERAL',
  startDate: '2026-06-15T14:00:00.000Z',
  endDate: '2026-06-15T15:00:00.000Z',
};

const CAPS: Array<{ field: string; cap: number }> = [
  { field: 'title', cap: 200 },
  { field: 'description', cap: 5000 },
  { field: 'location', cap: 200 },
  { field: 'unitNumber', cap: 50 },
  { field: 'notes', cap: 5000 },
];

describe('Calendar event DTOs — free-text @MaxLength caps (CAL-024)', () => {
  describe('CreateCalendarEventDto', () => {
    it('accepts free-text fields exactly at their cap', async () => {
      const dto = plainToInstance(CreateCalendarEventDto, {
        ...VALID_BASE,
        title: 'a'.repeat(200),
        description: 'b'.repeat(5000),
        location: 'c'.repeat(200),
        unitNumber: 'd'.repeat(50),
        notes: 'e'.repeat(5000),
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it.each(CAPS)('rejects $field exceeding its cap of $cap', async ({ field, cap }) => {
      const dto = plainToInstance(CreateCalendarEventDto, {
        ...VALID_BASE,
        [field]: 'x'.repeat(cap + 1),
      });
      const errors = await validate(dto);
      const fieldError = errors.find((e) => e.property === field);
      expect(fieldError).toBeDefined();
      expect(fieldError?.constraints).toHaveProperty('maxLength');
    });
  });

  describe('UpdateCalendarEventDto', () => {
    it.each(CAPS)('rejects $field exceeding its cap of $cap', async ({ field, cap }) => {
      const dto = plainToInstance(UpdateCalendarEventDto, {
        [field]: 'x'.repeat(cap + 1),
      });
      const errors = await validate(dto);
      const fieldError = errors.find((e) => e.property === field);
      expect(fieldError).toBeDefined();
      expect(fieldError?.constraints).toHaveProperty('maxLength');
    });
  });
});
