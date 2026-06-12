import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SupplierCategoriesController } from './supplier-categories.controller';
import { SupplierCategoriesService } from './supplier-categories.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupplierCategoriesController],
  providers: [SupplierCategoriesService],
  exports: [SupplierCategoriesService],
})
export class SupplierCategoriesModule {}
