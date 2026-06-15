import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTerraceSettingsDto } from './update-terrace-settings.dto';

async function validateKeywords(keywords: unknown): Promise<string[]> {
  const dto = plainToInstance(UpdateTerraceSettingsDto, { terraceGlobalKeywords: keywords });
  const errors = await validate(dto);
  return errors.flatMap((e) =>
    e.property === 'terraceGlobalKeywords' ? Object.keys(e.constraints ?? {}) : [],
  );
}

describe('UpdateTerraceSettingsDto — terraceGlobalKeywords min length (CAL-036)', () => {
  it('rejects a 1–2 char keyword that would over-fire the substring signal', async () => {
    const failures = await validateKeywords(['ab']);
    expect(failures).toContain('minLength');
  });

  it('accepts a keyword of at least 3 characters', async () => {
    const failures = await validateKeywords(['terraza', 'pad']);
    expect(failures).toEqual([]);
  });

  it('rejects when any one keyword in the list is too short', async () => {
    const failures = await validateKeywords(['terraza', 'a']);
    expect(failures).toContain('minLength');
  });
});

describe('UpdateTerraceSettingsDto — pendingHoldWindowHours (CAL-064)', () => {
  async function validateHold(value: unknown): Promise<string[]> {
    const dto = plainToInstance(UpdateTerraceSettingsDto, { pendingHoldWindowHours: value });
    const errors = await validate(dto);
    return errors.flatMap((e) =>
      e.property === 'pendingHoldWindowHours' ? Object.keys(e.constraints ?? {}) : [],
    );
  }

  it('accepts 0 (disabled)', async () => {
    expect(await validateHold(0)).toEqual([]);
  });

  it('accepts a positive whole-hour window', async () => {
    expect(await validateHold(48)).toEqual([]);
  });

  it('rejects a negative window', async () => {
    expect(await validateHold(-1)).toContain('min');
  });

  it('rejects a window beyond the 8760-hour (365-day) cap', async () => {
    expect(await validateHold(8761)).toContain('max');
  });

  it('rejects a non-integer window', async () => {
    expect(await validateHold(12.5)).toContain('isInt');
  });
});
