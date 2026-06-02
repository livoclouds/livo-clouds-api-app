import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { buildDevNotificationSample } from './dev-notification-samples';
import { EmitDevNotificationDto } from './dto/emit-dev-notification.dto';
import { isR1NotificationType } from './notification-role-matrix';
import { NotificationsService } from './notifications.service';

/**
 * Dev-only utility: fires a real notification to the **current** user through
 * the production persist → SSE → Web Push pipeline. It deliberately bypasses
 * recipient resolution (so the caller — who would be the "actor" of a real
 * action — still receives it) and aggregation (so every trigger produces a
 * distinct, toast-eligible arrival). The web Notification Playground drives it.
 *
 * Hard-gated to non-production: in production every route here returns 404, so
 * the endpoint simply does not exist there regardless of any client-side flag.
 */
@ApiExcludeController()
@Controller('condominiums/:condominiumSlug/notifications/dev')
@UseGuards(CondominiumAccessGuard)
export class NotificationsDevController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('emit')
  @HttpCode(HttpStatus.CREATED)
  async emit(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: EmitDevNotificationDto,
  ): Promise<{ id: string; type: string }> {
    // The playground is a development-only tool; never expose it in prod.
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    if (!isR1NotificationType(dto.type)) {
      throw new BadRequestException(
        `Unsupported notification type: ${dto.type}`,
      );
    }

    const slug = await this.notificationsService.resolveCondominiumSlug(
      req.condominiumId,
    );
    const sample = buildDevNotificationSample(dto.type, slug, new Date());
    const row = await this.notificationsService.createDirectForUser({
      userId: user.sub,
      condominiumId: req.condominiumId,
      type: dto.type,
      title: sample.title,
      message: sample.message,
      data: sample.data,
      linkUrl: sample.linkUrl,
    });
    return { id: row.id, type: row.type };
  }
}
