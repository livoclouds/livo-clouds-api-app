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
import { JwtPayload, UserRole } from '../../common/types';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { ListCommonAreasDto } from './dto/list-common-areas.dto';
import { ListInventoryItemsDto } from './dto/list-inventory-items.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import { InventoryService } from './inventory.service';

// `condominiumId` is set by CondominiumAccessGuard from the session-bound slug;
// `user` is the authenticated JWT payload. Common-area mutations forward
// `user.sub` so every audit row records the acting user.
type AuthedRequest = { condominiumId: string; user: JwtPayload };

@ApiTags('Inventory')
@UseGuards(CondominiumAccessGuard, RolesGuard)
@Controller()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ─── Common Areas ──────────────────────────────────────────────

  @Get('condominiums/:condominiumSlug/common-areas')
  @ApiOperation({ summary: 'List common areas (paginated)' })
  findAllAreas(
    @Request() req: { condominiumId: string },
    @Query() query: ListCommonAreasDto,
  ) {
    return this.inventoryService.findAllAreas(req.condominiumId, query);
  }

  @Post('condominiums/:condominiumSlug/common-areas')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create common area' })
  createArea(
    @Request() req: AuthedRequest,
    @Body() dto: CreateCommonAreaDto,
  ) {
    return this.inventoryService.createArea(
      req.condominiumId,
      req.user.sub,
      dto,
    );
  }

  @Patch('condominiums/:condominiumSlug/common-areas/:id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update common area' })
  updateArea(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCommonAreaDto,
  ) {
    return this.inventoryService.updateArea(
      req.condominiumId,
      req.user.sub,
      id,
      dto,
    );
  }

  @Delete('condominiums/:condominiumSlug/common-areas/:id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Delete common area' })
  removeArea(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.inventoryService.removeArea(
      req.condominiumId,
      req.user.sub,
      id,
    );
  }

  // ─── Inventory Items ──────────────────────────────────────────

  @Get('condominiums/:condominiumSlug/inventory')
  @ApiOperation({ summary: 'List inventory items (paginated)' })
  findAllItems(
    @Request() req: { condominiumId: string },
    @Query() query: ListInventoryItemsDto,
  ) {
    return this.inventoryService.findAllItems(req.condominiumId, query);
  }

  @Post('condominiums/:condominiumSlug/inventory')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create inventory item' })
  createItem(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateInventoryItemDto,
  ) {
    return this.inventoryService.createItem(req.condominiumId, dto);
  }

  @Patch('condominiums/:condominiumSlug/inventory/:id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update inventory item' })
  updateItem(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: Partial<CreateInventoryItemDto>,
  ) {
    return this.inventoryService.updateItem(req.condominiumId, id, dto);
  }

  @Delete('condominiums/:condominiumSlug/inventory/:id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Delete inventory item' })
  removeItem(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.inventoryService.removeItem(req.condominiumId, id);
  }
}
