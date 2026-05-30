import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { AuditQuery, AuditService } from './audit.service';

@ApiTags('Audit')
@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('audit')
  @RequirePermission('platform.audit.read')
  @ApiOperation({ summary: 'Platform-wide audit logs (root only)' })
  platformLogs(@CurrentUser() user: JwtPayload, @Query() query: AuditQuery) {
    return this.auditService.findPlatformLogs(user, query);
  }

  @Get('condominiums/:condominiumSlug/audit')
  @UseGuards(CondominiumAccessGuard)
  @ApiOperation({ summary: 'Condominium audit logs' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: AuditQuery,
  ) {
    return this.auditService.findAll(req.condominiumId, query);
  }
}
