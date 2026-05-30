import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemStatusService } from './system-status.service';

@ApiTags('System Status')
@RequirePermission('platform.systemStatus.read')
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
