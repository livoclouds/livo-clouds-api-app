import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { WhatsAppRenotifyScheduler } from './whatsapp-renotify.scheduler';

const BEARER_PREFIX = 'Bearer ';

@ApiTags('Internal Cron')
@Controller('internal/cron')
export class WhatsAppInternalCronController {
  private readonly logger = new Logger(WhatsAppInternalCronController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly renotify: WhatsAppRenotifyScheduler,
  ) {}

  @Post('renotify')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Trigger the WhatsApp re-notification scan (Vercel Cron Jobs entry point)',
  })
  async renotifyEndpoint(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ ok: true; scanned: number; dispatched: number }> {
    this.verifyCronSecret(authorization);
    const result = await this.renotify.scanAndReNotify();
    this.logger.log(
      `[renotify] scanned=${result.scanned} dispatched=${result.dispatched}`,
    );
    return { ok: true, ...result };
  }

  private verifyCronSecret(authorization: string | undefined): void {
    const expected = this.configService.get<string>('CRON_SECRET', '');
    if (!expected) {
      this.logger.error('[renotify] CRON_SECRET not configured');
      throw new UnauthorizedException();
    }
    if (!authorization || !authorization.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException();
    }
    const provided = authorization.slice(BEARER_PREFIX.length);
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException();
    }
  }
}
