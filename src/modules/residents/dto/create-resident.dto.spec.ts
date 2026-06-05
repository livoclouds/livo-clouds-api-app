import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateResidentDto, ResidentTypeDto } from './create-resident.dto';

// Mirrors the global ValidationPipe (transform + implicit conversion) so the
// test exercises the same coercion path the controller — and the bulk-import
// endpoint — receive.
function transform(plain: Record<string, unknown>): CreateResidentDto {
  return plainToInstance(CreateResidentDto, plain, {
    enableImplicitConversion: true,
  });
}

function validProps(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unitNumber: 'A01',
    residentType: ResidentTypeDto.OWNER,
    firstName: 'Carlos',
    lastName: 'Mendoza',
    ...over,
  };
}

function errorFields(plain: Record<string, unknown>): string[] {
  return validateSync(transform(plain)).map((e) => e.property);
}

describe('CreateResidentDto — input hardening', () => {
  it('accepts a minimal valid resident', () => {
    expect(validateSync(transform(validProps()))).toHaveLength(0);
  });

  describe('string length caps', () => {
    it('rejects an over-long unitNumber (>32)', () => {
      expect(errorFields(validProps({ unitNumber: 'X'.repeat(33) }))).toContain(
        'unitNumber',
      );
    });

    it('rejects an over-long firstName / lastName (>64)', () => {
      expect(errorFields(validProps({ firstName: 'X'.repeat(65) }))).toContain('firstName');
      expect(errorFields(validProps({ lastName: 'X'.repeat(65) }))).toContain('lastName');
    });

    it('rejects an over-long email (>254)', () => {
      const longEmail = `${'a'.repeat(250)}@x.com`;
      expect(errorFields(validProps({ email: longEmail }))).toContain('email');
    });

    it('rejects an over-long notes (>1000)', () => {
      expect(errorFields(validProps({ notes: 'n'.repeat(1001) }))).toContain('notes');
    });

    it('accepts values at the boundary', () => {
      expect(
        validateSync(
          transform(
            validProps({
              unitNumber: 'U'.repeat(32),
              firstName: 'F'.repeat(64),
              notes: 'n'.repeat(1000),
            }),
          ),
        ),
      ).toHaveLength(0);
    });
  });

  describe('monthlyFee', () => {
    it('leaves an absent fee undefined (no NaN) — service defaults to 0', () => {
      const dto = transform(validProps());
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.monthlyFee).toBeUndefined();
    });

    it('coerces a numeric string and accepts it', () => {
      const dto = transform(validProps({ monthlyFee: '500.5' }));
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.monthlyFee).toBe(500.5);
    });

    it('rejects a negative fee', () => {
      expect(errorFields(validProps({ monthlyFee: -1 }))).toContain('monthlyFee');
    });

    it('rejects a non-numeric fee instead of writing NaN', () => {
      expect(errorFields(validProps({ monthlyFee: 'abc' }))).toContain('monthlyFee');
    });
  });

  describe('parkingSpots', () => {
    it('rejects a negative count', () => {
      expect(errorFields(validProps({ parkingSpots: -1 }))).toContain('parkingSpots');
    });

    it('rejects a count above the 0–10 range', () => {
      expect(errorFields(validProps({ parkingSpots: 11 }))).toContain('parkingSpots');
    });

    it('accepts the upper bound', () => {
      expect(validateSync(transform(validProps({ parkingSpots: 10 })))).toHaveLength(0);
    });
  });
});
