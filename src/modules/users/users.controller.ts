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
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('condominiums/:condominiumSlug/users')
@UseGuards(CondominiumAccessGuard, RolesGuard)
@Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users in a condominium' })
  findAll(@Request() req: { condominiumId: string }) {
    return this.usersService.findAll(req.condominiumId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.usersService.findOne(req.condominiumId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create user in a condominium' })
  create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.create(req.condominiumId, dto, user);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'Soft delete user' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.usersService.remove(req.condominiumId, id);
  }
}
