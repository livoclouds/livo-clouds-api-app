import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TransactionsService } from './transactions.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@ApiTags('Transactions')
@Controller('condominiums/:condominiumSlug/transactions')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'List transactions with filters and pagination' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: ListTransactionsDto,
  ) {
    return this.transactionsService.findAll(req.condominiumId, query);
  }

  @Get('unmatched')
  @ApiOperation({ summary: 'List transactions pending classification review' })
  findUnmatched(
    @Request() req: { condominiumId: string },
    @Query() query: ListTransactionsDto,
  ) {
    return this.transactionsService.findUnmatched(req.condominiumId, query);
  }
}
