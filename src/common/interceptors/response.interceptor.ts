import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { serializeDecimals } from '../utils/serialize-decimals.util';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, { data: T }> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<{ data: T }> {
    // Convert Prisma Decimal fields to numbers before wrapping so the wire
    // contract stays numeric for every endpoint (see serializeDecimals).
    return next.handle().pipe(map((data) => ({ data: serializeDecimals(data) })));
  }
}
