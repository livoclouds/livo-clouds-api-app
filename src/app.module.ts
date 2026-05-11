import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import appConfig from './config/app.config';
import corsConfig from './config/cors.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import storageConfig from './config/storage.config';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { CollectionModule } from './modules/collection/collection.module';
import { CondominiumsModule } from './modules/condominiums/condominiums.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ClassificationModule } from './modules/classification/classification.module';
import { ImportsModule } from './modules/imports/imports.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PettyCashModule } from './modules/petty-cash/petty-cash.module';
import { HealthController } from './health/health.controller';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { ResidentsModule } from './modules/residents/residents.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { ReconciliationRulesModule } from './modules/reconciliation-rules/reconciliation-rules.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      load: [appConfig, corsConfig, databaseConfig, jwtConfig, storageConfig],
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    AuditModule,
    CollectionModule,
    CondominiumsModule,
    ClassificationModule,
    DashboardModule,
    ImportsModule,
    TransactionsModule,
    InventoryModule,
    NotificationsModule,
    PettyCashModule,
    ReportsModule,
    ResidentsModule,
    SettingsModule,
    UsersModule,
    ReconciliationRulesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
