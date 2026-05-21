import { PartialType } from '@nestjs/swagger';
import { CreateVehicleDto } from './create-vehicle.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType excludes unsafe fields (id, residentId, condominiumId, createdAt,
// updatedAt) that are not part of the create contract.
export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}
