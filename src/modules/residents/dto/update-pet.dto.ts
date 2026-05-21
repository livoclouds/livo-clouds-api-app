import { PartialType } from '@nestjs/swagger';
import { CreatePetDto } from './create-pet.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType excludes unsafe fields (id, residentId, createdAt, updatedAt)
// that are not part of the create contract.
export class UpdatePetDto extends PartialType(CreatePetDto) {}
