import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ParsedTransactionDto } from './confirm-import.dto';

function makeRow(date: string): ParsedTransactionDto {
  return plainToInstance(ParsedTransactionDto, {
    date,
    description: 'PAGO UNIDAD 1',
    charges: 0,
    credits: 1500,
    balance: 1500,
    flowType: 'income',
  });
}

describe('ParsedTransactionDto.date — ISO-only contract (ENGINE-050)', () => {
  it('rejects D/M/YYYY dates — both parsers emit ISO, so a slash date can only end as false tampering', async () => {
    for (const date of ['15/01/2026', '1/1/2026', '31/12/2025']) {
      const errors = await validate(makeRow(date));
      expect(errors.map((e) => e.property)).toContain('date');
    }
  });

  it('accepts YYYY-MM-DD and full ISO timestamps', async () => {
    for (const date of [
      '2026-01-15',
      '2026-01-15T10:30',
      '2026-01-15T10:30:45',
      '2026-01-15T10:30:45.123Z',
      '2026-01-15T10:30:45+06:00',
    ]) {
      const errors = await validate(makeRow(date));
      expect(errors).toHaveLength(0);
    }
  });
});
