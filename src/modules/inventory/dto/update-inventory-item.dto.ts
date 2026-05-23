import { PartialType } from '@nestjs/swagger';
import { CreateInventoryItemDto } from './create-inventory-item.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType keeps every CreateInventoryItemDto field (and its validators) but
// makes them optional. A `Partial<CreateInventoryItemDto>` type erases to
// `Object` at runtime, which ValidationPipe skips entirely — letting unknown
// keys such as `condominiumId` through to Prisma (INV-003 mass assignment).
export class UpdateInventoryItemDto extends PartialType(CreateInventoryItemDto) {}
