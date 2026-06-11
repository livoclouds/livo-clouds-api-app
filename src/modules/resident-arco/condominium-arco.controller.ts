import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { BulkArcoActionDto } from './dto/bulk-arco-action.dto';
import { ExportArcoRequestsDto } from './dto/export-arco-requests.dto';
import { ListArcoRequestsDto } from './dto/list-arco-requests.dto';
import { ResidentArcoService } from './resident-arco.service';

type AuthedRequest = FastifyRequest & {
  condominiumId: string;
  user: JwtPayload;
};

const VIEW = 'residents.arco.view';
const MANAGE = 'residents.arco.manage';

// Condominium-level ARCO compliance surface — the cross-resident overview, the
// regulator export, metrics and bulk operations. Per-request management stays
// under ResidentArcoController.
@ApiTags('ARCO Compliance')
@Controller('condominiums/:condominiumSlug/arco')
@UseGuards(CondominiumAccessGuard)
export class CondominiumArcoController {
  constructor(private readonly service: ResidentArcoService) {}

  @Get()
  @RequirePermission(VIEW)
  @ApiOperation({ summary: 'List all ARCO requests in the condominium (compliance view)' })
  findAll(@Request() req: AuthedRequest, @Query() query: ListArcoRequestsDto) {
    return this.service.findAllByCondominium(req.condominiumId, req.user.sub, query);
  }

  // RP-012 — regulator-ready CSV export. Static segment, declared before any
  // dynamic route so it always wins.
  @Get('export.csv')
  @RequirePermission(VIEW)
  @Throttle({ burst: { limit: 2, ttl: 30_000 }, sustained: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Export the condominium ARCO requests as a streamed CSV' })
  exportCsv(
    @Request() req: AuthedRequest,
    @Param('condominiumSlug') condominiumSlug: string,
    @Query() query: ExportArcoRequestsDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const stream = this.service.exportCsv(req.condominiumId, req.user.sub, query);
    const filenameDate = new Date().toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="arco-requests_${condominiumSlug}_${filenameDate}.csv"`,
      )
      .header('Cache-Control', 'no-store');
    return reply.send(stream);
  }

  // RP-015 — compliance metrics (KPIs for the dashboard).
  @Get('metrics')
  @RequirePermission(VIEW)
  @ApiOperation({ summary: 'ARCO compliance metrics (response time, overdue %, rates)' })
  metrics(@Request() req: AuthedRequest) {
    return this.service.metrics(req.condominiumId, req.user.sub);
  }

  // RP-014 — bulk status update / soft delete across residents.
  @Post('bulk')
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Bulk status-update or soft-delete ARCO requests' })
  bulk(@Request() req: AuthedRequest, @Body() dto: BulkArcoActionDto) {
    return this.service.bulkUpdate(req.condominiumId, req.user.sub, dto);
  }
}
