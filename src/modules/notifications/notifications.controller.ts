import { Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('condominiums/:condominiumSlug/notifications')
@UseGuards(CondominiumAccessGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  findAll(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.findAll(req.condominiumId, user.sub);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  markRead(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markRead(req.condominiumId, id, user.sub);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markAllRead(req.condominiumId, user.sub);
  }
}
