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
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { AccountStatementDto } from '../collection/dto/account-statement.dto';
import { BulkCreateResidentsDto } from './dto/bulk-create-residents.dto';
import { BulkDeleteResidentsDto } from './dto/bulk-delete-residents.dto';
import { CreateAdditionalResidentDto } from './dto/create-additional-resident.dto';
import { CreatePetDto } from './dto/create-pet.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListResidentsDto } from './dto/list-residents.dto';
import { UpdateAdditionalResidentDto } from './dto/update-additional-resident.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { ResidentsService } from './residents.service';

// `condominiumId` is set by CondominiumAccessGuard from the session-bound slug;
// `user` is the authenticated JWT payload. Mutations forward `user.sub` so every
// audit row records the acting user.
type AuthedRequest = { condominiumId: string; user: JwtPayload };

@ApiTags('Residents')
@Controller('condominiums/:condominiumSlug/residents')
@UseGuards(CondominiumAccessGuard)
export class ResidentsController {
  constructor(private readonly residentsService: ResidentsService) {}

  @Get()
  @RequirePermission('residents.read')
  @ApiOperation({ summary: 'List residents' })
  findAll(@Request() req: AuthedRequest, @Query() dto: ListResidentsDto) {
    return this.residentsService.findAll(req.condominiumId, dto);
  }

  @Get(':id')
  @RequirePermission('residents.read')
  @ApiOperation({ summary: 'Get resident with full profile' })
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.residentsService.findOne(req.condominiumId, id);
  }

  // Composite resident 360 profile in one orchestrated call (RP-026): core
  // record + account statement + financial-health score + tenant currency. The
  // static 'profile' segment does not collide with the dynamic ':id' routes.
  // Dossier/ARCO are NOT included — they keep their own permission-gated endpoints.
  @Get(':id/profile')
  @RequirePermission('residents.read')
  @ApiOperation({
    summary: 'Composite resident 360 profile (core + account statement + financial health + currency)',
  })
  getProfile(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Query() dto: AccountStatementDto,
  ) {
    return this.residentsService.getProfile(req.condominiumId, id, dto);
  }

  @Post()
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Create resident' })
  create(@Request() req: AuthedRequest, @Body() dto: CreateResidentDto) {
    return this.residentsService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Update resident' })
  update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateResidentDto,
  ) {
    return this.residentsService.update(req.condominiumId, req.user.sub, id, dto);
  }

  @Delete(':id')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Soft delete resident' })
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.residentsService.remove(req.condominiumId, req.user.sub, id);
  }

  // POST (not DELETE) because the id list travels in the request body, which is
  // awkward for DELETE in Nest/Swagger. The static 'bulk-delete' segment does
  // not collide with the dynamic ':id' routes above.
  // Bulk-create from an imported spreadsheet. Static 'bulk' segment does not
  // collide with the dynamic ':id' routes. Throttled like the bank-import
  // endpoints — an import is a heavy, infrequent operation.
  @Post('bulk')
  @RequirePermission('residents.manage')
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Bulk-create residents from an import' })
  bulkCreate(
    @Request() req: AuthedRequest,
    @Body() dto: BulkCreateResidentsDto,
  ) {
    return this.residentsService.bulkCreate(
      req.condominiumId,
      req.user.sub,
      dto.residents,
    );
  }

  @Post('bulk-delete')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Soft delete several residents' })
  bulkRemove(
    @Request() req: AuthedRequest,
    @Body() dto: BulkDeleteResidentsDto,
  ) {
    return this.residentsService.removeMany(
      req.condominiumId,
      req.user.sub,
      dto.ids,
    );
  }

  @Post(':id/vehicles')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Add vehicle to resident' })
  addVehicle(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.residentsService.addVehicle(
      req.condominiumId,
      req.user.sub,
      residentId,
      dto,
    );
  }

  @Patch(':id/vehicles/:vehicleId')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Update vehicle' })
  updateVehicle(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.residentsService.updateVehicle(
      req.condominiumId,
      req.user.sub,
      residentId,
      vehicleId,
      dto,
    );
  }

  @Delete(':id/vehicles/:vehicleId')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Remove vehicle' })
  removeVehicle(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.residentsService.removeVehicle(
      req.condominiumId,
      req.user.sub,
      residentId,
      vehicleId,
    );
  }

  @Post(':id/pets')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Add pet to resident' })
  addPet(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Body() dto: CreatePetDto,
  ) {
    return this.residentsService.addPet(
      req.condominiumId,
      req.user.sub,
      residentId,
      dto,
    );
  }

  @Patch(':id/pets/:petId')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Update pet' })
  updatePet(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Param('petId') petId: string,
    @Body() dto: UpdatePetDto,
  ) {
    return this.residentsService.updatePet(
      req.condominiumId,
      req.user.sub,
      residentId,
      petId,
      dto,
    );
  }

  @Delete(':id/pets/:petId')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Remove pet' })
  removePet(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Param('petId') petId: string,
  ) {
    return this.residentsService.removePet(
      req.condominiumId,
      req.user.sub,
      residentId,
      petId,
    );
  }

  @Post(':id/additional-residents')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Add additional resident' })
  addAdditionalResident(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Body() dto: CreateAdditionalResidentDto,
  ) {
    return this.residentsService.addAdditionalResident(
      req.condominiumId,
      req.user.sub,
      residentId,
      dto,
    );
  }

  @Patch(':id/additional-residents/:additionalResidentId')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Update additional resident' })
  updateAdditionalResident(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Param('additionalResidentId') additionalResidentId: string,
    @Body() dto: UpdateAdditionalResidentDto,
  ) {
    return this.residentsService.updateAdditionalResident(
      req.condominiumId,
      req.user.sub,
      residentId,
      additionalResidentId,
      dto,
    );
  }

  @Delete(':id/additional-residents/:additionalResidentId')
  @RequirePermission('residents.manage')
  @ApiOperation({ summary: 'Remove additional resident' })
  removeAdditionalResident(
    @Request() req: AuthedRequest,
    @Param('id') residentId: string,
    @Param('additionalResidentId') additionalResidentId: string,
  ) {
    return this.residentsService.removeAdditionalResident(
      req.condominiumId,
      req.user.sub,
      residentId,
      additionalResidentId,
    );
  }
}
