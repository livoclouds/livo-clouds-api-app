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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

// RBAC Phase 2: access is governed by permissions (PermissionsGuard) instead of
// @Roles. The presets preserve the previous behaviour — ROOT and TENANT_ADMIN
// both hold users.read + users.manage; READ_ONLY/GUARD/RESIDENT hold neither.
// CondominiumAccessGuard still enforces tenant isolation.
@ApiTags('Users')
@Controller('condominiums/:condominiumSlug/users')
@UseGuards(CondominiumAccessGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users.read', 'users.manage')
  @ApiOperation({ summary: 'List users in a condominium' })
  findAll(@Request() req: { condominiumId: string }) {
    return this.usersService.findAll(req.condominiumId);
  }

  @Get(':id')
  @RequirePermission('users.read', 'users.manage')
  @ApiOperation({ summary: 'Get user by id' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.usersService.findOne(req.condominiumId, id);
  }

  @Post()
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Create user in a condominium' })
  create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.create(req.condominiumId, dto, user);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Update user' })
  update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.update(req.condominiumId, id, dto, user);
  }

  @Delete(':id')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Soft delete user' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.usersService.remove(req.condominiumId, id);
  }
}
