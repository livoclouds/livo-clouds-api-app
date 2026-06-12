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
import { CreateSupplierCategoryDto } from './dto/create-supplier-category.dto';
import { ListSupplierCategoriesDto } from './dto/list-supplier-categories.dto';
import { ReorderSupplierCategoriesDto } from './dto/reorder-supplier-categories.dto';
import { UpdateSupplierCategoryDto } from './dto/update-supplier-category.dto';
import { SupplierCategoriesService } from './supplier-categories.service';

@ApiTags('SupplierCategories')
@Controller('condominiums/:condominiumSlug/supplier-categories')
@UseGuards(CondominiumAccessGuard)
export class SupplierCategoriesController {
  constructor(private readonly service: SupplierCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List supplier categories for the condominium' })
  async findAll(
    @Request() req: { condominiumId: string },
    @Query() dto: ListSupplierCategoriesDto,
  ) {
    return this.service.findAll(req.condominiumId, {
      includeInactive: dto.includeInactive === 'true',
    });
  }

  @Post()
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Create a supplier category' })
  async create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateSupplierCategoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(req.condominiumId, dto, user.sub);
  }

  @Post('reorder')
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Reorder supplier categories' })
  async reorder(
    @Request() req: { condominiumId: string },
    @Body() dto: ReorderSupplierCategoriesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reorder(req.condominiumId, dto.categoryIds, user.sub);
  }

  @Patch(':id')
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Update a supplier category' })
  async update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateSupplierCategoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(req.condominiumId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Soft-delete a supplier category' })
  async remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.remove(req.condominiumId, id, user.sub);
    return { success: true };
  }
}
