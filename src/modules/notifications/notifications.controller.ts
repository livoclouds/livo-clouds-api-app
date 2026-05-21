import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('condominiums/:condominiumSlug/notifications')
@UseGuards(CondominiumAccessGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List inbox notifications for the current user' })
  list(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Query() dto: ListNotificationsDto,
  ) {
    return this.notificationsService.list({
      userId: user.sub,
      condominiumId: req.condominiumId,
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      unreadOnly: dto.unreadOnly,
      readOnly: dto.readOnly,
      includeDismissed: dto.includeDismissed,
      types: dto.types,
      from: dto.from,
      to: dto.to,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get the unread notification count' })
  getUnreadCount(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.getUnreadCount(req.condominiumId, user.sub);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences for the current user' })
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getPreferences(user.sub, user.role);
  }

  @Patch('preferences')
  @ApiOperation({
    summary: 'Update notification preferences for the current user',
  })
  updatePreferences(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(
      user.sub,
      user.role,
      dto.preferences,
    );
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markAllRead(req.condominiumId, user.sub);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markRead(req.condominiumId, id, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss a notification' })
  dismiss(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.dismiss(req.condominiumId, id, user.sub);
  }
}
