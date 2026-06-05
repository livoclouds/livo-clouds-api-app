import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerUserGuard } from './common/guards/throttler-user.guard';
import appConfig from './config/app.config';
import corsConfig from './config/cors.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import emailConfig from './config/email.config';
import storageConfig from './config/storage.config';
import whatsappConfig from './config/whatsapp.config';
import webPushConfig from './config/web-push.config';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { InactivityLockGuard } from './common/guards/inactivity-lock.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RbacModule } from './common/rbac/rbac.module';
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
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { SecurityModule } from './modules/security/security.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PettyCashModule } from './modules/petty-cash/petty-cash.module';
import { HealthController } from './health/health.controller';
import { ReportsModule } from './modules/reports/reports.module';
import { StorageModule } from './modules/storage/storage.module';
import { StorageAdminModule } from './modules/storage-admin/storage-admin.module';
import { PlatformUsersModule } from './modules/platform-users/platform-users.module';
import { ResidentsModule } from './modules/residents/residents.module';
import { ResidentDossierModule } from './modules/resident-dossier/resident-dossier.module';
import { ResidentArcoModule } from './modules/resident-arco/resident-arco.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { ReconciliationRulesModule } from './modules/reconciliation-rules/reconciliation-rules.module';
import { ExpenseCategoriesModule } from './modules/expense-categories/expense-categories.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CalendarReclassifyModule } from './modules/calendar/reclassify/calendar-reclassify.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { BankProfilesModule } from './modules/bank-profiles/bank-profiles.module';
import { SystemStatusModule } from './modules/system-status/system-status.module';
import { SupportModule } from './modules/support/support.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      load: [appConfig, corsConfig, databaseConfig, emailConfig, jwtConfig, storageConfig, whatsappConfig, webPushConfig],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        // Burst protection: max 20 requests in 10 seconds per user
        name: 'burst',
        ttl: 10_000,
        limit: 20,
      },
      {
        // Sustained protection: max 120 requests per minute per user
        // Normal tab-switching generates ~5-10 req/min; 120 is generous but blocks scripts
        name: 'sustained',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    RbacModule,
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
    SuppliersModule,
    SecurityModule,
    NotificationsModule,
    PettyCashModule,
    ReportsModule,
    ResidentsModule,
    ResidentDossierModule,
    ResidentArcoModule,
    SettingsModule,
    UsersModule,
    RolesModule,
    ReconciliationRulesModule,
    ExpenseCategoriesModule,
    CalendarModule,
    CalendarReclassifyModule,
    WhatsAppModule,
    BankProfilesModule,
    StorageAdminModule,
    PlatformUsersModule,
    SystemStatusModule,
    SupportModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerUserGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs after JwtAuthGuard so request.user (and its `sid`) is populated.
    { provide: APP_GUARD, useClass: InactivityLockGuard },
    // RBAC Phase 2: enforces @RequirePermission. No-op for routes without it, so
    // it coexists with the legacy @Roles guard during the migration.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
