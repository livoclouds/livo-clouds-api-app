import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { CollectionService } from './collection.service';
import { AccountStatementDto } from './dto/account-statement.dto';
import { ListByResidentDto } from './dto/list-by-resident.dto';
import { ListCollectionDto } from './dto/list-collection.dto';

@ApiTags('Collection')
@Controller('condominiums/:condominiumSlug/collection')
@UseGuards(CondominiumAccessGuard)
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get()
  @ApiOperation({ summary: 'Get collection matrix for a year (paginated)' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() dto: ListCollectionDto,
  ) {
    return this.collectionService.findAll(req.condominiumId, dto);
  }

  @Get('residents/:residentId')
  @ApiOperation({ summary: 'Get collection history for a resident (paginated)' })
  findByResident(
    @Request() req: { condominiumId: string },
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
    @Request() req: { condominiumId: string },
    @Param('residentId') residentId: string,
    @Query() dto: AccountStatementDto,
  ) {
    return this.collectionService.getAccountStatement(req.condominiumId, residentId, dto);
  }

  @Patch(':id')
  @RequirePermission('transactions.override')
  @ApiOperation({ summary: 'Manual override collection record' })
  update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: { status?: string; amountPaid?: number; paymentDate?: string; notes?: string },
  ) {
    return this.collectionService.update(req.condominiumId, id, dto);
  }
}
