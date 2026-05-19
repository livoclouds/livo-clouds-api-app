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
import { BankProfilesService } from './bank-profiles.service';
import { CreateBankProfileDto } from './dto/create-bank-profile.dto';
import { UpdateBankProfileDto } from './dto/update-bank-profile.dto';

@ApiTags('BankProfiles')
@Controller('condominiums/:condominiumSlug/bank-profiles')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class BankProfilesController {
  constructor(private readonly service: BankProfilesService) {}

  @Get('field-definitions/defaults')
  @ApiOperation({ summary: 'Return default canonical field definitions' })
  async defaults() {
    const fields = await this.service.getDefaultFieldDefinitions();
    return { fields };
  }

  @Get()
  @ApiOperation({ summary: 'List bank profiles for a condominium' })
  async findAll(@Request() req: { condominiumId: string }) {
    return this.service.findAll(req.condominiumId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a bank profile by id' })
  async findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.service.findOne(req.condominiumId, id);
  }

  @Post()
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create a bank profile' })
  async create(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBankProfileDto,
  ) {
    return this.service.create(req.condominiumId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update a bank profile' })
  async update(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBankProfileDto,
  ) {
    return this.service.update(req.condominiumId, id, dto, user);
  }

  @Post(':id/set-default')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Mark a bank profile as the default for the condominium' })
  async setDefault(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.service.setDefault(req.condominiumId, id, user);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Delete a bank profile (soft delete if referenced by batches)' })
  async remove(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.service.remove(req.condominiumId, id, user);
  }
}
