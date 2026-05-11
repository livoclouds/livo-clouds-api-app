import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/types';
import { ReconciliationRulesService } from './reconciliation-rules.service';
import { CreateReconciliationRuleDto } from './dto/create-reconciliation-rule.dto';
import { UpdateReconciliationRuleDto } from './dto/update-reconciliation-rule.dto';
import { ListReconciliationRulesDto } from './dto/list-reconciliation-rules.dto';

@ApiTags('ReconciliationRules')
@Controller('condominiums/:condominiumSlug/settings/reconciliation-rules')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class ReconciliationRulesController {
  constructor(private readonly service: ReconciliationRulesService) {}

  @Get()
  @ApiOperation({ summary: 'List reconciliation rules for a condominium' })
  async findAll(
    @Request() req: { condominiumId: string },
    @Query() dto: ListReconciliationRulesDto,
  ) {
    return this.service.findAll(req.condominiumId, dto);
  }

  @Post()
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create a reconciliation rule' })
  async create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateReconciliationRuleDto,
  ) {
    return this.service.create(req.condominiumId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update a reconciliation rule' })
  async update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateReconciliationRuleDto,
  ) {
    return this.service.update(req.condominiumId, id, dto);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Toggle isActive on a reconciliation rule' })
  async toggleActive(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.service.toggleActive(req.condominiumId, id);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Delete a reconciliation rule' })
  async remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    await this.service.remove(req.condominiumId, id);
    return { success: true };
  }
}
