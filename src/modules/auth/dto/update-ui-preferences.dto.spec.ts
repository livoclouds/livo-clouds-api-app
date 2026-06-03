import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateUiPreferencesDto } from './update-ui-preferences.dto';

// Mirrors the global ValidationPipe (transform + implicit conversion) so the
// test exercises the same coercion path the controller receives.
function transform(plain: Record<string, unknown>): UpdateUiPreferencesDto {
  return plainToInstance(UpdateUiPreferencesDto, plain, {
    enableImplicitConversion: true,
  });
}

describe('UpdateUiPreferencesDto', () => {
  it('accepts a valid HSL triplet primaryColor + enum fields', () => {
    const dto = transform({
      locale: 'es',
      themeMode: 'DARK',
      primaryColor: '213 76% 45%',
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a hex primaryColor (only HSL triplets are allowed)', () => {
    const dto = transform({ primaryColor: '#6366f1' });

    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('primaryColor');
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('allows null to clear locale and primaryColor overrides', () => {
    const dto = transform({ locale: null, primaryColor: null });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts an empty body (every field is optional)', () => {
    const dto = transform({});

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an unknown locale value', () => {
    const dto = transform({ locale: 'fr' });

    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('locale');
  });

  it('rejects an unknown themeMode value', () => {
    const dto = transform({ themeMode: 'NEON' });

    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('themeMode');
  });
});
