import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('condominiums/:condominiumSlug/reports')
@UseGuards(CondominiumAccessGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overdue')
  @ApiOperation({ summary: 'Get overdue residents report' })
  getOverdue(@Request() req: { condominiumId: string }) {
    return this.reportsService.getOverdue(req.condominiumId);
  }

  @Get('collection-matrix')
  @ApiOperation({ summary: 'Get annual collection matrix' })
  getCollectionMatrix(
    @Request() req: { condominiumId: string },
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.reportsService.getCollectionMatrix(req.condominiumId, y);
  }

  @Get('executive-summary')
  @ApiOperation({ summary: 'Get executive summary for a period' })
  getExecutiveSummary(
    @Request() req: { condominiumId: string },
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year, 10) : now.getFullYear();
    const m = month ? parseInt(month, 10) : now.getMonth() + 1;
    return this.reportsService.getExecutiveSummary(req.condominiumId, y, m);
  }
}
