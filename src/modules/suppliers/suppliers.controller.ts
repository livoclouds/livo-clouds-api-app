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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

// `condominiumId` is set by CondominiumAccessGuard from the session-bound slug;
// `user` is the authenticated JWT payload. Mutations forward `user.sub` so
// every audit row records the acting user.
type AuthedRequest = { condominiumId: string; user: JwtPayload };

@ApiTags('Suppliers')
@UseGuards(CondominiumAccessGuard)
@Controller('condominiums/:condominiumSlug/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'List suppliers (paginated)' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: ListSuppliersDto,
  ) {
    return this.suppliersService.findAll(req.condominiumId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier by id' })
  findOne(@Request() req: { condominiumId: string }, @Param('id') id: string) {
    return this.suppliersService.findOne(req.condominiumId, id);
  }

  @Post()
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Create supplier' })
  create(@Request() req: AuthedRequest, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Update supplier' })
  update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(
      req.condominiumId,
      req.user.sub,
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('suppliers.manage')
  @ApiOperation({ summary: 'Delete supplier' })
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.suppliersService.remove(req.condominiumId, req.user.sub, id);
  }
}
