import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListResidentsDto } from './list-residents.dto';

// Mirrors the global ValidationPipe (transform + implicit conversion) so the
// test exercises the same coercion path the controller receives.
function transform(plain: Record<string, unknown>): ListResidentsDto {
  return plainToInstance(ListResidentsDto, plain, {
    enableImplicitConversion: true,
  });
}

describe('ListResidentsDto — Phase 5 (RES-009)', () => {
  it('accepts the full set of supported query params', () => {
    const dto = transform({
      page: '2',
      limit: '25',
      q: 'Lopez',
      paymentStatus: 'OVERDUE',
      unitNumber: 'A01',
      unitExact: 'true',
      name: 'Carlos',
      phone: '555',
      email: 'a@b.com',
      residentType: 'OWNER',
      minDebt: '500',
      hasVehicles: 'true',
      hasTag: 'false',
      hasPets: 'true',
      documentation: 'complete',
      dateFrom: '2026-01-01',
      dateTo: '2026-05-22',
      sortBy: 'debt',
      sortDirection: 'desc',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(25);
    expect(dto.minDebt).toBe(500);
  });

  it('coerces query-string booleans and leaves absent ones undefined', () => {
    const dto = transform({ hasVehicles: 'true', hasTag: 'false' });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.hasVehicles).toBe(true);
    expect(dto.hasTag).toBe(false);
    expect(dto.hasPets).toBeUndefined();
    expect(dto.unitExact).toBeUndefined();
  });

  it('rejects an unknown sort field', () => {
    const errors = validateSync(transform({ sortBy: 'ssn' }));
    expect(errors.some((e) => e.property === 'sortBy')).toBe(true);
  });

  it('rejects an unknown documentation filter value', () => {
    const errors = validateSync(transform({ documentation: 'partial' }));
    expect(errors.some((e) => e.property === 'documentation')).toBe(true);
  });

  it('rejects a limit above the 500 cap', () => {
    const errors = validateSync(transform({ limit: '5000' }));
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects a negative minDebt', () => {
    const errors = validateSync(transform({ minDebt: '-1' }));
    expect(errors.some((e) => e.property === 'minDebt')).toBe(true);
  });

  it('applies page/limit defaults when omitted', () => {
    const dto = transform({});
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(500);
  });
});
