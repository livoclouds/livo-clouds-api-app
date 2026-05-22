import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  COMMON_AREA_SORT_FIELDS,
  ListCommonAreasDto,
} from './list-common-areas.dto';

// Mirrors the global ValidationPipe (transform + implicit conversion) so the
// test exercises the same coercion path the controller receives.
function transform(plain: Record<string, unknown>): ListCommonAreasDto {
  return plainToInstance(ListCommonAreasDto, plain, {
    enableImplicitConversion: true,
  });
}

describe('ListCommonAreasDto — Phase 5 (CMA-013)', () => {
  it('accepts the full set of supported query params', () => {
    const dto = transform({
      page: '2',
      limit: '50',
      name: 'pool',
      status: 'MAINTENANCE',
      responsible: 'Ana',
      sortBy: 'status',
      sortDirection: 'desc',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(dto.name).toBe('pool');
    expect(dto.status).toBe('MAINTENANCE');
  });

  it('applies page/limit defaults and leaves optional filters undefined', () => {
    const dto = transform({});

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(200);
    expect(dto.name).toBeUndefined();
    expect(dto.status).toBeUndefined();
    expect(dto.responsible).toBeUndefined();
    expect(dto.sortBy).toBeUndefined();
    expect(dto.sortDirection).toBeUndefined();
  });

  it('rejects a status outside CommonAreaStatus', () => {
    const errors = validateSync(transform({ status: 'ARCHIVED' }));
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('rejects a sortBy outside the allow-list', () => {
    const errors = validateSync(transform({ sortBy: 'condominiumId' }));
    expect(errors.some((e) => e.property === 'sortBy')).toBe(true);
  });

  it('rejects an invalid sortDirection', () => {
    const errors = validateSync(transform({ sortDirection: 'ascending' }));
    expect(errors.some((e) => e.property === 'sortDirection')).toBe(true);
  });

  it('accepts every allow-listed sortBy value', () => {
    for (const field of COMMON_AREA_SORT_FIELDS) {
      expect(validateSync(transform({ sortBy: field }))).toHaveLength(0);
    }
  });

  it('rejects a non-positive page', () => {
    const errors = validateSync(transform({ page: '0' }));
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects a limit above the 500 cap', () => {
    const errors = validateSync(transform({ limit: '5000' }));
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects a name longer than 100 characters', () => {
    const errors = validateSync(transform({ name: 'x'.repeat(101) }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a responsible filter longer than 100 characters', () => {
    const errors = validateSync(transform({ responsible: 'x'.repeat(101) }));
    expect(errors.some((e) => e.property === 'responsible')).toBe(true);
  });
});
