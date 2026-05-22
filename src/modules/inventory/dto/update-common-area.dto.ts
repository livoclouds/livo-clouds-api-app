import { PartialType } from '@nestjs/swagger';
import { CreateCommonAreaDto } from './create-common-area.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType keeps every CreateCommonAreaDto field (and its validators) but
// makes them optional. A `Partial<CreateCommonAreaDto>` type erases to `Object`
// at runtime, which ValidationPipe skips entirely — letting unknown keys such
// as `condominiumId` through to Prisma (CMA-003 mass assignment).
export class UpdateCommonAreaDto extends PartialType(CreateCommonAreaDto) {}
