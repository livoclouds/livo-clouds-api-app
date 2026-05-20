import { Controller, Get, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import {
  NotificationsSseGateway,
  NotificationStreamEvent,
} from './notifications.gateway';
import { NotificationsService } from './notifications.service';

/** Comment heartbeat cadence — keeps proxies and load balancers from idling. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Server-Sent Events stream of notifications for the authenticated user.
 *
 * The stream is implemented with the raw Fastify reply rather than the Nest
 * `@Sse()` decorator: the global ResponseInterceptor wraps every handler return
 * value in `{ data }`, which would corrupt the SSE wire format, and `@Sse()`
 * cannot emit raw `: ping` comment heartbeats. `reply.hijack()` detaches the
 * socket from Fastify's response pipeline so we own the framing.
 */
@ApiTags('Notifications')
@Controller('condominiums/:condominiumSlug/notifications')
@UseGuards(CondominiumAccessGuard)
export class NotificationsSseController {
  private readonly logger = new Logger(NotificationsSseController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly gateway: NotificationsSseGateway,
  ) {}

  @Get('stream')
  @ApiOperation({
    summary: 'Open a Server-Sent Events stream of notifications',
  })
  async stream(
    @Req() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // The stream is always bound to the JWT subject; any userId query
    // parameter is intentionally ignored.
    const userId = user.sub;
    const condominiumId = req.condominiumId;
    const res = reply.raw;

    // Take over the socket so Fastify does not send its own response.
    reply.hijack();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx and similar) so frames flush at once.
      'X-Accel-Buffering': 'no',
    });

    const writeEvent = (event: NotificationStreamEvent): void => {
      if (res.writableEnded) {
        return;
      }
      let frame = '';
      if (event.id) {
        frame += `id: ${event.id}\n`;
      }
      frame += `event: ${event.event}\n`;
      frame += `data: ${JSON.stringify(event.data)}\n\n`;
      res.write(frame);
    };

    // Initial sync frame: unread count + the most recent notifications.
    try {
      const sync = await this.notificationsService.getStreamSync(
        condominiumId,
        userId,
      );
      writeEvent({ event: 'sync', data: sync });
    } catch (err) {
      this.logger.error(
        `Failed to send SSE sync for user ${userId}: ${String(err)}`,
      );
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    // Register the per-connection stream; future notifications arrive here.
    const subject = this.gateway.register(userId);
    const subscription = subject.subscribe((event) => writeEvent(event));

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);
    // Never let the heartbeat timer hold the event loop open on shutdown.
    heartbeat.unref();

    let closed = false;
    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      subscription.unsubscribe();
      this.gateway.unregister(userId, subject);
      if (!res.writableEnded) {
        res.end();
      }
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }
}
