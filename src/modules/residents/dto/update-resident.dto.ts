import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { CreateResidentDto } from './create-resident.dto';
import { ResidentDocumentationDto } from './resident-documentation.dto';

// Runtime DTO class so ValidationPipe can validate and whitelist PATCH bodies.
// PartialType keeps every CreateResidentDto field (and its validators) but makes
// them optional. The two members below extend the update contract with fields
// the web modal persists but that are not part of the create contract.
//
// `debt` is deliberately NOT included: it is a derived financial figure
// (outstanding balance), not a manually-editable field. Exposing it as a raw
// PATCH field would let it drift from the CollectionRecord / Transaction ledger
// with no audit of why — see RES-004 in the residents audit.
export class UpdateResidentDto extends PartialType(CreateResidentDto) {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ type: ResidentDocumentationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResidentDocumentationDto)
  documentation?: ResidentDocumentationDto;
}
