import { ModuleCategory } from './system-status.types';

/**
 * Canonical registry of every real platform module, grouped by category.
 *
 * This is the single source of truth for which modules the System Status page
 * shows — the web app renders whatever this endpoint returns and hardcodes
 * nothing. Keep this list aligned with the NestJS `src/modules/*` directory.
 *
 * `hasAuditSignal` marks modules that actually write to `AuditLog` (verified
 * against the codebase). For modules that don't, status reflects DB
 * reachability only — and the `technical.determination` says so explicitly,
 * rather than inventing an availability number.
 */

export type EnrichmentKind = 'imports' | 'whatsapp';

export interface ModuleRegistryEntry {
  key: string;
  category: ModuleCategory;
  hasAuditSignal: boolean;
  enrichment?: EnrichmentKind;
}

export const MODULE_REGISTRY: readonly ModuleRegistryEntry[] = [
  // Financial
  { key: 'dashboard', category: 'financial', hasAuditSignal: false },
  { key: 'imports', category: 'financial', hasAuditSignal: true, enrichment: 'imports' },
  { key: 'transactions', category: 'financial', hasAuditSignal: true },
  { key: 'bank-profiles', category: 'financial', hasAuditSignal: true },
  { key: 'classification', category: 'financial', hasAuditSignal: true },
  { key: 'reconciliation-rules', category: 'financial', hasAuditSignal: false },
  { key: 'collection', category: 'financial', hasAuditSignal: false },
  { key: 'reports', category: 'financial', hasAuditSignal: false },
  { key: 'petty-cash', category: 'financial', hasAuditSignal: false },

  // Residents
  { key: 'residents', category: 'residents', hasAuditSignal: true },

  // Operations
  { key: 'calendar', category: 'operations', hasAuditSignal: true },
  { key: 'inventory', category: 'operations', hasAuditSignal: true },

  // Communications
  { key: 'notifications', category: 'communications', hasAuditSignal: false },
  { key: 'whatsapp', category: 'communications', hasAuditSignal: true, enrichment: 'whatsapp' },
  { key: 'email', category: 'communications', hasAuditSignal: false },

  // Platform
  { key: 'auth', category: 'platform', hasAuditSignal: true },
  { key: 'users', category: 'platform', hasAuditSignal: false },
  { key: 'settings', category: 'platform', hasAuditSignal: false },
  { key: 'audit', category: 'platform', hasAuditSignal: false },
  { key: 'storage', category: 'platform', hasAuditSignal: false },
  { key: 'storage-admin', category: 'platform', hasAuditSignal: false },
  { key: 'condominiums', category: 'platform', hasAuditSignal: false },
] as const;
