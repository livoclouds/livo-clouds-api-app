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
