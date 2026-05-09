import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { CondominiumsService } from './condominiums.service';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { UpdateCondominiumDto } from './dto/update-condominium.dto';

@ApiTags('Condominiums')
@Controller('condominiums')
@UseGuards(RolesGuard)
export class CondominiumsController {
  constructor(private readonly condominiumsService: CondominiumsService) {}

  @Get()
  @ApiOperation({ summary: 'List condominiums' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.condominiumsService.findAll(user);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get condominium by slug' })
  findOne(@Param('slug') slug: string) {
    return this.condominiumsService.findBySlug(slug);
  }

  @Post()
  @Roles(UserRole.ROOT)
  @ApiOperation({ summary: 'Create condominium (root only)' })
  create(@Body() dto: CreateCondominiumDto) {
    return this.condominiumsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update condominium' })
  update(@Param('id') id: string, @Body() dto: UpdateCondominiumDto) {
    return this.condominiumsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT)
  @ApiOperation({ summary: 'Deactivate condominium (root only)' })
  remove(@Param('id') id: string) {
    return this.condominiumsService.remove(id);
  }
}
