import { PartialType } from '@nestjs/swagger';
import { CreateSupplierDto } from './create-supplier.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType keeps every CreateSupplierDto field (and its validators) but makes
// them optional. A `Partial<CreateSupplierDto>` type erases to `Object` at
// runtime, which ValidationPipe skips entirely — letting unknown keys such as
// `condominiumId` through to Prisma (mass-assignment guard).
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
