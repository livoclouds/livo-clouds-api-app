import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function makeCallHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

const context = {} as ExecutionContext;

describe('ResponseInterceptor', () => {
  it('wraps the handler result in a { data } envelope', async () => {
    const interceptor = new ResponseInterceptor();
    const result = await firstValueFrom(
      interceptor.intercept(context, makeCallHandler({ id: 'tx-1' })),
    );
    expect(result).toEqual({ data: { id: 'tx-1' } });
  });

  it('converts nested Prisma Decimals to numbers inside the envelope', async () => {
    const interceptor = new ResponseInterceptor();
    const payload = {
      data: [
        {
          id: 'tx-1',
          credits: new Prisma.Decimal('500.00'),
          charges: null,
          balance: new Prisma.Decimal('320638.37'),
        },
      ],
      meta: { total: 1, page: 1, limit: 15, totalPages: 1 },
    };

    const result = await firstValueFrom(
      interceptor.intercept(context, makeCallHandler(payload)),
    );

    expect(result).toEqual({
      data: {
        data: [
          { id: 'tx-1', credits: 500, charges: null, balance: 320638.37 },
        ],
        meta: { total: 1, page: 1, limit: 15, totalPages: 1 },
      },
    });
  });
});
