import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { CollectionService } from './collection.service';

@ApiTags('Collection')
@Controller('condominiums/:condominiumSlug/collection')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get()
  @ApiOperation({ summary: 'Get collection matrix for a year' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.collectionService.findAll(req.condominiumId, y);
  }

  @Get('residents/:residentId')
  @ApiOperation({ summary: 'Get collection history for a resident' })
  findByResident(
    @Request() req: { condominiumId: string },
    @Param('residentId') residentId: string,
  ) {
    return this.collectionService.findByResident(req.condominiumId, residentId);
  }

  @Get('residents/:residentId/account-statement')
  @ApiOperation({ summary: 'Get resident account statement with transactions and collection records' })
  getAccountStatement(
    @Request() req: { condominiumId: string },
    @Param('residentId') residentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.collectionService.getAccountStatement(req.condominiumId, residentId, {
      from,
      to,
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
    });
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Manual override collection record' })
  update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: { status?: string; amountPaid?: number; paymentDate?: string; notes?: string },
  ) {
    return this.collectionService.update(req.condominiumId, id, dto);
  }
}
