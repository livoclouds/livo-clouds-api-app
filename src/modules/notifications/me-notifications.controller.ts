import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtPayload } from '../../common/types';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateNotificationScopeDto } from './dto/update-notification-scope.dto';
import { NotificationsService } from './notifications.service';

/**
 * ROOT-only, non-tenant-scoped notification routes. Scope-based filtering of
 * the cross-tenant inbox against RootNotificationScope is a Phase 2/3 concern;
 * this listing returns the ROOT user's own notification rows across tenants.
 */
@ApiTags('Notifications')
@Controller('me')
@RequirePermission('platform.condominiums.read')
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
      readOnly: dto.readOnly,
      includeDismissed: dto.includeDismissed,
      snoozedOnly: dto.snoozedOnly,
      includeSnoozed: dto.includeSnoozed,
      types: dto.types,
      from: dto.from,
      to: dto.to,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
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

  @Get('notification-preferences')
  @ApiOperation({ summary: 'Get notification preferences for the current ROOT user' })
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getPreferences(user.sub, user.role);
  }

  @Patch('notification-preferences')
  @ApiOperation({ summary: 'Update notification preferences for the current ROOT user' })
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
}
