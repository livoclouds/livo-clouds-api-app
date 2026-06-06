import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

const CONNECTION_DROP_RETRY_MS = 1_000;

@Injectable()
export class PrismaReconnectInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err) => {
        const isConnectionDrop =
          err instanceof PrismaClientKnownRequestError &&
          (err.code === 'P1017' ||
            err.message.includes('Server has closed'));
        if (isConnectionDrop) {
          // PrismaService.$on('error') triggers a $connect() in the background;
          // wait briefly for it to complete, then replay the request once.
          return timer(CONNECTION_DROP_RETRY_MS).pipe(
            switchMap(() => next.handle()),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
