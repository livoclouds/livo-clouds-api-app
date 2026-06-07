import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CollectionService } from './collection.service';
import { AccountStatementDto } from './dto/account-statement.dto';
import { FinancialHealthDto } from './dto/financial-health.dto';
import { ListByResidentDto } from './dto/list-by-resident.dto';
import { ListCollectionDto } from './dto/list-collection.dto';
import { UpdateCollectionRecordDto } from './dto/update-collection-record.dto';

type AuthedRequest = { condominiumId: string; user: JwtPayload };

@ApiTags('Collection')
@Controller('condominiums/:condominiumSlug/collection')
@UseGuards(CondominiumAccessGuard)
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get()
  @ApiOperation({ summary: 'Get collection matrix for a year (paginated)' })
  findAll(
    @Request() req: AuthedRequest,
    @Query() dto: ListCollectionDto,
  ) {
    return this.collectionService.findAll(req.condominiumId, dto);
  }

  @Get('residents/:residentId')
  @ApiOperation({ summary: 'Get collection history for a resident (paginated)' })
  findByResident(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Query() dto: ListByResidentDto,
  ) {
    return this.collectionService.findByResident(
      req.condominiumId,
      residentId,
      dto,
    );
  }

  @Get('residents/:residentId/account-statement')
  @ApiOperation({ summary: 'Get resident account statement with transactions and collection records' })
  getAccountStatement(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Query() dto: AccountStatementDto,
  ) {
    return this.collectionService.getAccountStatement(req.condominiumId, residentId, dto);
  }

  @Get('residents/:residentId/financial-health')
  @ApiOperation({ summary: 'Explainable financial-health score + derived trend history for a resident' })
  getFinancialHealth(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Query() dto: FinancialHealthDto,
  ) {
    return this.collectionService.getFinancialHealth(
      req.condominiumId,
      residentId,
      dto.historyMonths,
    );
  }

  @Patch(':id')
  @RequirePermission('transactions.override')
  @ApiOperation({ summary: 'Manual override collection record' })
  update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionRecordDto,
  ) {
    return this.collectionService.update(req.condominiumId, req.user.sub, id, dto);
  }
}
