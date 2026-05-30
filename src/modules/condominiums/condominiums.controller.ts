import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtPayload } from '../../common/types';
import { CondominiumsService } from './condominiums.service';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { UpdateCondominiumDto } from './dto/update-condominium.dto';

@ApiTags('Condominiums')
@Controller('condominiums')
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
  @RequirePermission('platform.condominiums.manage')
  @ApiOperation({ summary: 'Create condominium (root only)' })
  create(@Body() dto: CreateCondominiumDto) {
    return this.condominiumsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('settings.update')
  @ApiOperation({ summary: 'Update condominium' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCondominiumDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.condominiumsService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission('platform.condominiums.manage')
  @ApiOperation({ summary: 'Deactivate condominium (root only)' })
  remove(@Param('id') id: string) {
    return this.condominiumsService.remove(id);
  }
}
