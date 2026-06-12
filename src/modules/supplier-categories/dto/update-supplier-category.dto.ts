import { PartialType } from '@nestjs/swagger';
import { CreateSupplierCategoryDto } from './create-supplier-category.dto';

export class UpdateSupplierCategoryDto extends PartialType(CreateSupplierCategoryDto) {}
