import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { SystemStatusService } from './system-status.service';

@ApiTags('System Status')
@UseGuards(RolesGuard)
@Roles(UserRole.ROOT)
@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  @ApiOperation({
    summary:
      'Real, on-demand health snapshot for every platform module (root only). Cached server-side ~45s.',
  })
  getStatus() {
    return this.service.getSnapshot();
  }
}
