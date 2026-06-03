import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CreateMovementDto } from './dto/create-movement.dto';
import { ListPettyCashDto } from './dto/list-petty-cash.dto';
import { PettyCashService } from './petty-cash.service';

@ApiTags('Petty Cash')
@Controller('condominiums/:condominiumSlug/petty-cash')
@UseGuards(CondominiumAccessGuard)
export class PettyCashController {
  constructor(private readonly pettyCashService: PettyCashService) {}

  @Get()
  @ApiOperation({ summary: 'List petty cash movements (paginated)' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: ListPettyCashDto,
  ) {
    return this.pettyCashService.findAll(req.condominiumId, query);
  }

  @Get('category-breakdown')
  @ApiOperation({ summary: 'Expense breakdown by category for a period' })
  getCategoryBreakdown(
    @Request() req: { condominiumId: string },
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? parseInt(year, 10) : now.getFullYear();
    const m = month ? parseInt(month, 10) : now.getMonth() + 1;
    return this.pettyCashService.getCategoryBreakdown(req.condominiumId, y, m);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get movement by id' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.pettyCashService.findOne(req.condominiumId, id);
  }

  @Post()
  @RequirePermission('pettyCash.manage')
  @ApiOperation({ summary: 'Create petty cash movement' })
  create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateMovementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pettyCashService.create(req.condominiumId, dto, user);
  }

  @Post(':id/approve')
  @RequirePermission('pettyCash.manage')
  @ApiOperation({ summary: 'Approve movement' })
  approve(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pettyCashService.approve(req.condominiumId, id, user.sub);
  }

  @Post(':id/reject')
  @RequirePermission('pettyCash.manage')
  @ApiOperation({ summary: 'Reject movement' })
  reject(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pettyCashService.reject(req.condominiumId, id, user.sub);
  }
}
