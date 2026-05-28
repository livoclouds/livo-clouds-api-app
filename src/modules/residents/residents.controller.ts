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
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class ResidentsController {
  constructor(private readonly residentsService: ResidentsService) {}

  @Get()
  @ApiOperation({ summary: 'List residents' })
  findAll(@Request() req: AuthedRequest, @Query() dto: ListResidentsDto) {
    return this.residentsService.findAll(req.condominiumId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get resident with full profile' })
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.residentsService.findOne(req.condominiumId, id);
  }

  @Post()
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create resident' })
  create(@Request() req: AuthedRequest, @Body() dto: CreateResidentDto) {
    return this.residentsService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update resident' })
  update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateResidentDto,
  ) {
    return this.residentsService.update(req.condominiumId, req.user.sub, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Soft delete resident' })
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.residentsService.remove(req.condominiumId, req.user.sub, id);
  }

  // POST (not DELETE) because the id list travels in the request body, which is
  // awkward for DELETE in Nest/Swagger. The static 'bulk-delete' segment does
  // not collide with the dynamic ':id' routes above.
  @Post('bulk-delete')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
