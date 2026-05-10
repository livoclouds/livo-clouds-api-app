import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassificationService } from './classification.service';
import { ManualMatchDto } from './dto/manual-match.dto';
import { ManualClassifyDto } from './dto/manual-classify.dto';

@ApiTags('Classification')
@Controller('condominiums/:condominiumSlug')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class ClassificationController {
  constructor(
    private readonly classificationService: ClassificationService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('imports/:batchId/classify')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Re-run classification for an import batch' })
  async reclassifyBatch(
    @Request() req: { condominiumId: string },
    @Param('batchId') batchId: string,
  ) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, condominiumId: req.condominiumId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');

    const summary = await this.classificationService.reclassifyBatch(
      req.condominiumId,
      batchId,
    );
    return { data: summary };
  }

  @Patch('transactions/:id/match')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Manually match a transaction to a resident' })
  async manualMatch(
    @Request() req: { condominiumId: string },
    @Param('id') transactionId: string,
    @Body() dto: ManualMatchDto,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId: req.condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.classificationService.manualMatch(
      req.condominiumId,
      transactionId,
      dto.residentId,
    );
    return { data: { success: true } };
  }

  @Patch('transactions/:id/classify')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Manually classify a transaction with custom fields' })
  async manualClassify(
    @Request() req: { condominiumId: string },
    @Param('id') transactionId: string,
    @Body() dto: ManualClassifyDto,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId: req.condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.classificationService.manualClassify(
      req.condominiumId,
      transactionId,
      dto,
    );
    return { data: { success: true } };
  }

  @Patch('transactions/:id/unmatch')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Remove resident match from a transaction' })
  async unmatch(
    @Request() req: { condominiumId: string },
    @Param('id') transactionId: string,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId: req.condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.classificationService.unmatch(req.condominiumId, transactionId);
    return { data: { success: true } };
  }
}
