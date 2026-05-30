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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { PERMISSION_CATALOG } from '../../common/rbac/permission-catalog';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

// RBAC Phase 2: governed by permissions. Reading roles/catalog is open to anyone
// who manages users (so the user editor can list assignable roles); mutating
// custom roles is restricted to platform.roles.manage (Developer/Supervisor) —
// an intentional tightening over the old @Roles(ROOT, TENANT_ADMIN).
@ApiTags('Roles')
@Controller('condominiums/:condominiumSlug/roles')
@UseGuards(CondominiumAccessGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('platform.roles.manage', 'users.read', 'users.manage')
  @ApiOperation({ summary: 'List assignable roles (system + this condominium)' })
  findAll(@Request() req: { condominiumId: string }) {
    return this.rolesService.findAll(req.condominiumId);
  }

  @Get('catalog')
  @RequirePermission('platform.roles.manage', 'users.read', 'users.manage')
  @ApiOperation({ summary: 'Permission catalog (sections/subsections/actions)' })
  catalog() {
    return { permissions: PERMISSION_CATALOG };
  }

  @Get(':id')
  @RequirePermission('platform.roles.manage', 'users.read', 'users.manage')
  @ApiOperation({ summary: 'Get a role by id' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.rolesService.findOne(req.condominiumId, id);
  }

  @Post()
  @RequirePermission('platform.roles.manage')
  @ApiOperation({ summary: 'Create a custom role for this condominium' })
  create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateRoleDto,
  ) {
    return this.rolesService.create(req.condominiumId, dto);
  }

  @Patch(':id')
  @RequirePermission('platform.roles.manage')
  @ApiOperation({ summary: 'Update a custom role' })
  update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(req.condominiumId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('platform.roles.manage')
  @ApiOperation({ summary: 'Soft delete a custom role' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.rolesService.remove(req.condominiumId, id);
  }
}
