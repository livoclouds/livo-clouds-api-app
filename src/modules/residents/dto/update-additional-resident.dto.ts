import { PartialType } from '@nestjs/swagger';
import { CreateAdditionalResidentDto } from './create-additional-resident.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType keeps every CreateAdditionalResidentDto field (and its validators)
// but makes them optional — and inherently excludes unsafe fields (`id`,
// `residentId`, `createdAt`, `updatedAt`) that are not part of the create
// contract.
export class UpdateAdditionalResidentDto extends PartialType(
  CreateAdditionalResidentDto,
) {}
