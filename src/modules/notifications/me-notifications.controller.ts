import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationScopeDto } from './dto/update-notification-scope.dto';
import { NotificationsService } from './notifications.service';

/**
 * ROOT-only, non-tenant-scoped notification routes. Scope-based filtering of
 * the cross-tenant inbox against RootNotificationScope is a Phase 2/3 concern;
 * this listing returns the ROOT user's own notification rows across tenants.
 */
@ApiTags('Notifications')
@Controller('me')
@UseGuards(RolesGuard)
@Roles(UserRole.ROOT)
export class MeNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({
    summary: 'List cross-tenant notifications for the current ROOT user',
  })
  list(@CurrentUser() user: JwtPayload, @Query() dto: ListNotificationsDto) {
    return this.notificationsService.list({
      userId: user.sub,
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      unreadOnly: dto.unreadOnly,
      includeDismissed: dto.includeDismissed,
      types: dto.types,
      from: dto.from,
      to: dto.to,
    });
  }

  @Get('notification-scope')
  @ApiOperation({ summary: 'Get the ROOT notification scope' })
  getScope(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getRootScope(user.sub);
  }

  @Patch('notification-scope')
  @ApiOperation({ summary: 'Update the ROOT notification scope' })
  updateScope(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateNotificationScopeDto,
  ) {
    return this.notificationsService.updateRootScope(user.sub, dto);
  }
}
