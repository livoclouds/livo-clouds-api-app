import { PartialType } from '@nestjs/swagger';
import { CreateQuotationDto } from './create-quotation.dto';

/**
 * Partial update of a provider quote — every field of CreateQuotationDto becomes
 * optional while keeping its validation rules.
 */
export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}
