import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AllocationItemDto } from './manual-classify.dto';

function makeAllocation(allocatedAmount: number): AllocationItemDto {
  return plainToInstance(AllocationItemDto, {
    unitNumber: '307',
    residentId: '4a1f1f2e-9d1c-4f7e-8a36-0b2f3c4d5e6f',
    allocatedAmount,
  });
}

describe('AllocationItemDto.allocatedAmount — minimum one cent (ENGINE-052)', () => {
  it('rejects a zero-amount slice', async () => {
    const errors = await validate(makeAllocation(0));
    expect(errors.map((e) => e.property)).toContain('allocatedAmount');
  });

  it('rejects negative amounts', async () => {
    const errors = await validate(makeAllocation(-10));
    expect(errors.map((e) => e.property)).toContain('allocatedAmount');
  });

  it('accepts one cent and above with 2 decimals', async () => {
    for (const amount of [0.01, 1, 499.99, 1500]) {
      const errors = await validate(makeAllocation(amount));
      expect(errors).toHaveLength(0);
    }
  });

  it('still rejects more than 2 decimal places', async () => {
    const errors = await validate(makeAllocation(10.005));
    expect(errors.map((e) => e.property)).toContain('allocatedAmount');
  });
});
