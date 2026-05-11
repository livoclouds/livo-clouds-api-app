import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'API health check' })
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
