/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/**
 * RBAC-006: Guard Coverage Check (Phase 5)
 *
 * Automated CI assertion that every tenant-scoped controller keeps
 * CondominiumAccessGuard and every non-public mutation route explicitly
 * declares @RequirePermission. Uses Reflect.getMetadata so no NestJS
 * TestingModule or database is needed — just importing the classes triggers
 * decorator execution and writes the metadata.
 *
 * When a future controller or route is added without the required decorators,
 * this spec fails with a clear message naming the offending controller and
 * method. The fixture describe at the bottom proves the detection logic itself
 * is working correctly.
 *
 * Metadata keys (from NestJS internals):
 *   '__guards__'       — set by @UseGuards() on class or method
 *   'method'           — HTTP verb enum (GET=0, POST=1, PUT=2, DELETE=3, PATCH=4)
 *   REQUIRE_PERMISSION_KEY — set by @RequirePermission()
 *   IS_PUBLIC_KEY      — set by @Public()
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { CondominiumAccessGuard } from '../guards/condominium-access.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

// ── All controllers ──────────────────────────────────────────────────────────
import { AuditController } from '../../modules/audit/audit.controller';
import { BankProfilesController } from '../../modules/bank-profiles/bank-profiles.controller';
import { CalendarController } from '../../modules/calendar/calendar.controller';
import { ClassificationController } from '../../modules/classification/classification.controller';
import { CollectionController } from '../../modules/collection/collection.controller';
import { CondominiumsController } from '../../modules/condominiums/condominiums.controller';
import { DashboardController } from '../../modules/dashboard/dashboard.controller';
import { ImportsController } from '../../modules/imports/imports.controller';
import { InventoryController } from '../../modules/inventory/inventory.controller';
import { MeNotificationsController } from '../../modules/notifications/me-notifications.controller';
import { NotificationsController } from '../../modules/notifications/notifications.controller';
import { NotificationsSseController } from '../../modules/notifications/notifications.sse.controller';
import { PettyCashController } from '../../modules/petty-cash/petty-cash.controller';
import { PlatformUsersController } from '../../modules/platform-users/platform-users.controller';
import { ReconciliationRulesController } from '../../modules/reconciliation-rules/reconciliation-rules.controller';
import { ReportsController } from '../../modules/reports/reports.controller';
import { ResidentsController } from '../../modules/residents/residents.controller';
import { RolesController } from '../../modules/roles/roles.controller';
import { SecurityController } from '../../modules/security/security.controller';
import { SettingsController } from '../../modules/settings/settings.controller';
import { StorageAdminController } from '../../modules/storage-admin/storage-admin.controller';
import { SupportController } from '../../modules/support/support.controller';
import { TransactionsController } from '../../modules/transactions/transactions.controller';
import { UsersController } from '../../modules/users/users.controller';
import { WhatsAppController } from '../../modules/whatsapp/whatsapp.controller';

// ── Metadata constants ───────────────────────────────────────────────────────
// NestJS internal keys — these are stable across minor versions.
const GUARDS_METADATA = '__guards__';
const METHOD_METADATA = 'method';

// HTTP verbs that constitute mutations and must be permission-gated.
const MUTATION_VERBS: RequestMethod[] = [
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
];

// ── Helper functions ─────────────────────────────────────────────────────────

function methodsOf(ctrl: Function): string[] {
  return Object.getOwnPropertyNames(ctrl.prototype).filter(
    (k) => k !== 'constructor',
  );
}

function httpVerbOf(ctrl: Function, method: string): RequestMethod | undefined {
  return Reflect.getMetadata(METHOD_METADATA, ctrl.prototype[method]);
}

function hasCondominiumGuardOnClass(ctrl: Function): boolean {
  const guards: Function[] =
    Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? [];
  return guards.some((g) => g === CondominiumAccessGuard);
}

function hasCondominiumGuardOnMethod(ctrl: Function, method: string): boolean {
  const guards: Function[] =
    Reflect.getMetadata(GUARDS_METADATA, ctrl.prototype[method]) ?? [];
  return guards.some((g) => g === CondominiumAccessGuard);
}

/** True when @RequirePermission is declared on the method OR on the class. */
function hasRequirePermission(ctrl: Function, method: string): boolean {
  const onMethod = Reflect.getMetadata(
    REQUIRE_PERMISSION_KEY,
    ctrl.prototype[method],
  );
  const onClass = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, ctrl);
  return (
    (Array.isArray(onMethod) && onMethod.length > 0) ||
    (Array.isArray(onClass) && onClass.length > 0)
  );
}

/** True when the method or the class is marked @Public (JWT-exempt). */
function isPublicRoute(ctrl: Function, method: string): boolean {
  return (
    Reflect.getMetadata(IS_PUBLIC_KEY, ctrl.prototype[method]) === true ||
    Reflect.getMetadata(IS_PUBLIC_KEY, ctrl) === true
  );
}

// ── Controller lists ─────────────────────────────────────────────────────────

/**
 * Tenant-scoped controllers: those whose routes begin with
 * `condominiums/:condominiumSlug/`. Every controller in this list must carry
 * @UseGuards(CondominiumAccessGuard) at the CLASS level.
 *
 * Excluded controllers (documented):
 *   AuditController         — per-method guard on the tenant route; tested separately
 *   AuthController          — no condominiumSlug routes; tenant scoped via JWT payload at login
 *   CondominiumsController  — platform-wide CRUD on the Condominium entity itself
 *   PlatformUsersController — cross-condominium by design; gated by platform.users.manage
 *   MeNotificationsController — ROOT cross-condominium inbox; no condominiumSlug
 *   StorageAdminController  — platform-wide; no condominiumSlug
 *   SystemStatusController  — platform-wide health; no condominiumSlug
 *   WhatsAppWebhookController — @Public with Meta signature auth; no RBAC
 *   WhatsAppInternalCronController — @Public with cron-secret bearer; no RBAC
 *   HealthController        — @Public infrastructure health check
 *   SupportController       — Support Center is available to EVERY authenticated
 *                             role, so its mutations are intentionally NOT
 *                             permission-gated (excluded from Check A). Its
 *                             tenant-scoped ticket routes still carry class-level
 *                             CondominiumAccessGuard — asserted explicitly in
 *                             Check B below.
 */
const TENANT_SCOPED_CONTROLLERS: Function[] = [
  BankProfilesController,
  CalendarController,
  ClassificationController,
  CollectionController,
  DashboardController,
  ImportsController,
  InventoryController,
  NotificationsController,
  NotificationsSseController,
  PettyCashController,
  ReconciliationRulesController,
  ReportsController,
  ResidentsController,
  RolesController,
  SecurityController,
  SettingsController,
  TransactionsController,
  UsersController,
  WhatsAppController,
];

/**
 * Controllers whose non-public mutation methods (POST/PUT/PATCH/DELETE) must
 * carry @RequirePermission. Includes both tenant-scoped and platform-scoped
 * controllers.
 *
 * Excluded controllers (documented):
 *   AuthController              — mutations are @Public or JWT-gated only;
 *                                 RBAC permissions do not apply by design
 *   WhatsAppWebhookController   — @Public POST with Meta signature auth
 *   WhatsAppInternalCronController — @Public POST with cron-secret bearer auth
 *   HealthController            — GET-only, @Public
 *   SupportController          — open to every authenticated role (file a ticket,
 *                                vote/view an article); intentionally not
 *                                permission-gated. Tenant guard verified in Check B.
 */
const MUTATION_GUARDED_CONTROLLERS: Function[] = [
  // Tenant-scoped (all must be in TENANT_SCOPED_CONTROLLERS above)
  ...TENANT_SCOPED_CONTROLLERS,
  // Platform-scoped (cross-condominium, but still permission-gated)
  AuditController,
  CondominiumsController,
  MeNotificationsController,
  PlatformUsersController,
  StorageAdminController,
];

// ── Check A — Every mutation must declare @RequirePermission ─────────────────

describe('[RBAC-006] Check A — every non-public mutation declares @RequirePermission', () => {
  it('no mutation route is missing @RequirePermission', () => {
    const violations: string[] = [];

    for (const ctrl of MUTATION_GUARDED_CONTROLLERS) {
      for (const method of methodsOf(ctrl)) {
        const verb = httpVerbOf(ctrl, method);
        if (!MUTATION_VERBS.includes(verb as RequestMethod)) continue;
        if (isPublicRoute(ctrl, method)) continue;
        if (!hasRequirePermission(ctrl, method)) {
          violations.push(`${ctrl.name}.${method}`);
        }
      }
    }

    expect(violations).toEqual(
      // Clear failure message: lists every offending controller.method
      [],
    );
  });
});

// ── Check B — Tenant-scoped controllers carry CondominiumAccessGuard ─────────

describe('[RBAC-006] Check B — tenant-scoped controllers carry CondominiumAccessGuard', () => {
  it.each(TENANT_SCOPED_CONTROLLERS.map((c) => [c.name, c]))(
    '%s: class-level CondominiumAccessGuard',
    (_name, ctrl) => {
      expect(hasCondominiumGuardOnClass(ctrl)).toBe(true);
    },
  );

  // AuditController uses per-method guard on the tenant route only.
  it('AuditController.findAll: method-level CondominiumAccessGuard on the tenant route', () => {
    expect(hasCondominiumGuardOnMethod(AuditController, 'findAll')).toBe(true);
  });

  // SupportController is excluded from permission gating (all-roles access) but
  // its tenant-scoped ticket routes must still carry the tenant guard.
  it('SupportController: class-level CondominiumAccessGuard', () => {
    expect(hasCondominiumGuardOnClass(SupportController)).toBe(true);
  });
});

// ── Fixture — the detection helpers themselves are verified ───────────────────
//
// These tests prove the helper functions can DETECT violations. If the helpers
// were broken to always return true, the fixture tests would immediately fail.

describe('[RBAC-006] Fixture — detection helpers correctly identify missing guards', () => {
  // A bare class with an HTTP method but no @RequirePermission or @UseGuards.
  class UnsafeController {}
  const proto = UnsafeController.prototype as Record<string, unknown>;
  proto.createItem = function () {};

  // Simulate @Post() metadata on createItem (no @RequirePermission, no @UseGuards)
  Reflect.defineMetadata(
    METHOD_METADATA,
    RequestMethod.POST,
    proto.createItem as object,
  );

  it('httpVerbOf returns POST for a method with @Post metadata', () => {
    expect(httpVerbOf(UnsafeController, 'createItem')).toBe(RequestMethod.POST);
  });

  it('hasRequirePermission returns false when @RequirePermission is absent', () => {
    expect(hasRequirePermission(UnsafeController, 'createItem')).toBe(false);
  });

  it('hasCondominiumGuardOnClass returns false when @UseGuards is absent', () => {
    expect(hasCondominiumGuardOnClass(UnsafeController)).toBe(false);
  });

  it('Check A logic: correctly identifies createItem as a violation', () => {
    const violations = methodsOf(UnsafeController).filter((method) => {
      const verb = httpVerbOf(UnsafeController, method);
      if (!MUTATION_VERBS.includes(verb as RequestMethod)) return false;
      if (isPublicRoute(UnsafeController, method)) return false;
      return !hasRequirePermission(UnsafeController, method);
    });
    expect(violations).toContain('createItem');
  });

  it('Check B logic: correctly identifies UnsafeController as lacking guard', () => {
    expect(hasCondominiumGuardOnClass(UnsafeController)).toBe(false);
  });
});
