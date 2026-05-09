import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { AuditQuery, AuditService } from './audit.service';

@ApiTags('Audit')
@UseGuards(RolesGuard)
@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('audit')
  @Roles(UserRole.ROOT)
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
