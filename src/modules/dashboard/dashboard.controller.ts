import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('condominiums/:condominiumSlug/dashboard')
@UseGuards(CondominiumAccessGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get dashboard KPIs and recent activity' })
  getKpis(
    @Request() req: { condominiumId: string },
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year, 10) : now.getFullYear();
    const m = month ? parseInt(month, 10) : now.getMonth() + 1;
    return this.dashboardService.getKpis(req.condominiumId, y, m);
  }

  @Get('trend')
  @ApiOperation({ summary: 'Get 12-month income/expense trend for a year' })
  getTrend(
    @Request() req: { condominiumId: string },
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.dashboardService.getMonthlyTrend(req.condominiumId, y);
  }
}
