import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtPayload } from '../../common/types';
import { MoveUserDto } from './dto/move-user.dto';
import { PlatformUsersService } from './platform-users.service';

// RBAC Phase 3: platform-scoped user operations that cross tenant isolation
// (e.g. a Supervisor moving an admin between condominiums). Guarded by
// platform.users.manage; deliberately NOT behind CondominiumAccessGuard.
@ApiTags('Platform Users')
@RequirePermission('platform.users.manage')
@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly service: PlatformUsersService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Move a user to another condominium (platform op)' })
  move(
    @Param('id') id: string,
    @Body() dto: MoveUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.move(id, dto, user);
  }
}
