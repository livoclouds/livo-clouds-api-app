import {
  Body,
  Controller,
  Delete,
  Get,
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
import { PERMISSION_CATALOG } from '../../common/rbac/permission-catalog';
import { UserRole } from '../../common/types';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@Controller('condominiums/:condominiumSlug/roles')
@UseGuards(CondominiumAccessGuard, RolesGuard)
@Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List assignable roles (system + this condominium)' })
  findAll(@Request() req: { condominiumId: string }) {
    return this.rolesService.findAll(req.condominiumId);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Permission catalog (sections/subsections/actions)' })
  catalog() {
    return { permissions: PERMISSION_CATALOG };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by id' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.rolesService.findOne(req.condominiumId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom role for this condominium' })
  create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateRoleDto,
  ) {
    return this.rolesService.create(req.condominiumId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a custom role' })
  update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(req.condominiumId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a custom role' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.rolesService.remove(req.condominiumId, id);
  }
}
