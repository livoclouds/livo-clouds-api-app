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
import { UserRole } from '../../common/types';
import { CreatePetDto } from './dto/create-pet.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ResidentsService } from './residents.service';

@ApiTags('Residents')
@Controller('condominiums/:condominiumSlug/residents')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class ResidentsController {
  constructor(private readonly residentsService: ResidentsService) {}

  @Get()
  @ApiOperation({ summary: 'List residents' })
  findAll(@Request() req: { condominiumId: string }) {
    return this.residentsService.findAll(req.condominiumId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get resident with full profile' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.residentsService.findOne(req.condominiumId, id);
  }

  @Post()
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create resident' })
  create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateResidentDto,
  ) {
    return this.residentsService.create(req.condominiumId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update resident' })
  update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: Partial<CreateResidentDto>,
  ) {
    return this.residentsService.update(req.condominiumId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Soft delete resident' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.residentsService.remove(req.condominiumId, id);
  }

  @Post(':id/vehicles')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Add vehicle to resident' })
  addVehicle(
    @Request() req: { condominiumId: string },
    @Param('id') residentId: string,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.residentsService.addVehicle(req.condominiumId, residentId, dto);
  }

  @Patch(':id/vehicles/:vehicleId')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update vehicle' })
  updateVehicle(
    @Request() req: { condominiumId: string },
    @Param('id') residentId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: Partial<CreateVehicleDto>,
  ) {
    return this.residentsService.updateVehicle(
      req.condominiumId,
      residentId,
      vehicleId,
      dto,
    );
  }

  @Delete(':id/vehicles/:vehicleId')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Remove vehicle' })
  removeVehicle(
    @Request() req: { condominiumId: string },
    @Param('id') residentId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.residentsService.removeVehicle(
      req.condominiumId,
      residentId,
      vehicleId,
    );
  }

  @Post(':id/pets')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Add pet to resident' })
  addPet(
    @Request() req: { condominiumId: string },
    @Param('id') residentId: string,
    @Body() dto: CreatePetDto,
  ) {
    return this.residentsService.addPet(req.condominiumId, residentId, dto);
  }

  @Patch(':id/pets/:petId')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update pet' })
  updatePet(
    @Request() req: { condominiumId: string },
    @Param('id') residentId: string,
    @Param('petId') petId: string,
    @Body() dto: Partial<CreatePetDto>,
  ) {
    return this.residentsService.updatePet(
      req.condominiumId,
      residentId,
      petId,
      dto,
    );
  }

  @Delete(':id/pets/:petId')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Remove pet' })
  removePet(
    @Request() req: { condominiumId: string },
    @Param('id') residentId: string,
    @Param('petId') petId: string,
  ) {
    return this.residentsService.removePet(req.condominiumId, residentId, petId);
  }
}
