import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ReconciliationRuleKind } from '@prisma/client';
// `re2` uses CommonJS `export = RE2`; import-equals resolves to the constructor
// at runtime with esModuleInterop off (see classification.service.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import RE2 = require('re2');

/**
 * Defense-in-depth cap on a user-provided extraction regex. Mirrors
 * MAX_EXTRACTION_PATTERN_LENGTH in the classification engine so a pattern that
 * passes validation is also accepted at classify time.
 */
export const MAX_EXTRACTION_PATTERN_LENGTH = 200;

/**
 * Heuristic blocklist for the most common catastrophic-backtracking shapes
 * (nested quantifiers). With the engine now matching via RE2 (linear-time), this
 * is no longer the primary ReDoS defense — it stays as an early, friendly reject
 * so admins get clear feedback at save time instead of a pattern that quietly
 * never fires. Reconciliation rules are admin-only (per-tenant) configuration.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\([^)]*[+*][^)]*\)\s*[+*]/, // (a+)+, (a*)*, (.+)+
  /\[[^\]]*\][+*]\s*[+*]/, // [a-z]+ +
];

/** Number of capture groups in a compiled regex, via an always-empty alternative. */
function captureGroupCount(source: string): number {
  try {
    const probe = new RegExp(`${source}|`);
    const match = probe.exec('');
    return match ? match.length - 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * Validates a `unitExtractionPattern`: present, within the length cap, free of
 * obvious catastrophic-backtracking shapes, compilable, and exposing the capture
 * group referenced by the sibling `unitExtractionGroup` (default 1).
 */
@ValidatorConstraint({ name: 'safeUnitExtractionPattern', async: false })
export class SafeRegexConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.length > MAX_EXTRACTION_PATTERN_LENGTH) return false;
    if (DANGEROUS_PATTERNS.some((d) => d.test(value))) return false;
    // Compile-check with RE2 (the same engine used at classify time) so an
    // accepted pattern is guaranteed runnable: RE2 rejects backreferences and
    // lookaround, which would otherwise pass a JS-RegExp check and then silently
    // never fire in the engine.
    try {
      new RE2(value, 'i');
    } catch {
      return false;
    }
    const group =
      (args.object as { unitExtractionGroup?: number }).unitExtractionGroup ?? 1;
    const groups = captureGroupCount(value);
    return group >= 1 && group <= groups;
  }

  defaultMessage(args: ValidationArguments): string {
    const value = args.value as unknown;
    if (typeof value === 'string' && value.length > MAX_EXTRACTION_PATTERN_LENGTH) {
      return `unitExtractionPattern must be at most ${MAX_EXTRACTION_PATTERN_LENGTH} characters`;
    }
    return 'unitExtractionPattern must be a safe regular expression exposing the configured capture group';
  }
}

/**
 * Object-level shape check, by rule kind:
 *  - UNIT    → exactly one unit outcome (assignedUnitNumber XOR unitExtractionPattern),
 *              no expense outcome.
 *  - EXPENSE → at least one expense outcome (expenseCategoryId and/or supplierId),
 *              no unit outcome.
 *  - CONCEPT → neither a unit nor an expense outcome.
 * Attached to an always-present field (`name`) so it runs on create.
 */
@ValidatorConstraint({ name: 'unitOutcomeShape', async: false })
export class UnitOutcomeShapeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as {
      ruleKind?: ReconciliationRuleKind;
      assignedUnitNumber?: string;
      unitExtractionPattern?: string;
      expenseCategoryId?: string;
      supplierId?: string;
    };
    const kind = o.ruleKind ?? ReconciliationRuleKind.CONCEPT;
    const hasAssign =
      typeof o.assignedUnitNumber === 'string' && o.assignedUnitNumber.length > 0;
    const hasPattern =
      typeof o.unitExtractionPattern === 'string' &&
      o.unitExtractionPattern.length > 0;
    const hasExpenseOutcome =
      (typeof o.expenseCategoryId === 'string' && o.expenseCategoryId.length > 0) ||
      (typeof o.supplierId === 'string' && o.supplierId.length > 0);

    if (kind === ReconciliationRuleKind.UNIT) {
      return hasAssign !== hasPattern && !hasExpenseOutcome; // exactly one unit outcome
    }
    if (kind === ReconciliationRuleKind.EXPENSE) {
      return hasExpenseOutcome && !hasAssign && !hasPattern; // ≥1 expense outcome, no unit
    }
    return !hasAssign && !hasPattern && !hasExpenseOutcome; // CONCEPT carries neither
  }

  defaultMessage(): string {
    return 'A UNIT rule requires exactly one of assignedUnitNumber or unitExtractionPattern; an EXPENSE rule requires at least one of expenseCategoryId or supplierId; a CONCEPT rule must set none of them.';
  }
}
