import { PartialType } from '@nestjs/swagger';
import { CreateResidentDto } from './create-resident.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType keeps every CreateResidentDto field (and its validators) but makes
// them optional — and inherently excludes unsafe fields (condominiumId, id,
// debt, paymentStatus, documentation, deletedAt) that are not part of the
// create contract.
export class UpdateResidentDto extends PartialType(CreateResidentDto) {}
