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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { ListExpenseCategoriesDto } from './dto/list-expense-categories.dto';
import { ReorderExpenseCategoriesDto } from './dto/reorder-expense-categories.dto';

@ApiTags('ExpenseCategories')
@Controller('condominiums/:condominiumSlug/settings/expense-categories')
@UseGuards(CondominiumAccessGuard)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List expense categories for a condominium' })
  async findAll(
    @Request() req: { condominiumId: string },
    @Query() dto: ListExpenseCategoriesDto,
  ) {
    return this.service.findAll(req.condominiumId, {
      includeInactive: dto.includeInactive === 'true',
    });
  }

  @Post()
  @RequirePermission('paymentRules.manage')
  @ApiOperation({ summary: 'Create an expense category' })
  async create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateExpenseCategoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(req.condominiumId, dto, user.sub);
  }

  @Post('reorder')
  @RequirePermission('paymentRules.manage')
  @ApiOperation({
    summary:
      'Reorder expense categories. The body must list every category of the condominium exactly once in the new desired order.',
  })
  async reorder(
    @Request() req: { condominiumId: string },
    @Body() dto: ReorderExpenseCategoriesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reorder(req.condominiumId, dto.categoryIds, user.sub);
  }

  @Patch(':id')
  @RequirePermission('paymentRules.manage')
  @ApiOperation({ summary: 'Update an expense category' })
  async update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(req.condominiumId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermission('paymentRules.manage')
  @ApiOperation({ summary: 'Soft-delete an expense category (system rows are protected)' })
  async remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.remove(req.condominiumId, id, user.sub);
    return { success: true };
  }
}
