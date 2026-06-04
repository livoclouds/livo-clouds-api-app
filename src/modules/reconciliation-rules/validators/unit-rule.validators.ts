import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ReconciliationRuleKind } from '@prisma/client';

/**
 * Defense-in-depth cap on a user-provided extraction regex. Mirrors
 * MAX_EXTRACTION_PATTERN_LENGTH in the classification engine so a pattern that
 * passes validation is also accepted at classify time.
 */
export const MAX_EXTRACTION_PATTERN_LENGTH = 200;

/**
 * Heuristic blocklist for the most common catastrophic-backtracking shapes
 * (nested quantifiers). This is NOT an exhaustive ReDoS oracle — it is one layer
 * alongside the length cap and the engine's try/catch. Reconciliation rules are
 * admin-only (per-tenant) configuration, so the blast radius of a bad pattern is
 * the tenant's own classification batch, not a public endpoint.
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
    try {
      new RegExp(value, 'i');
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
 * Object-level shape check. A UNIT rule must carry exactly one outcome
 * (assignedUnitNumber XOR unitExtractionPattern); a CONCEPT rule must carry
 * neither. Attached to an always-present field (`name`) so it runs on create.
 */
@ValidatorConstraint({ name: 'unitOutcomeShape', async: false })
export class UnitOutcomeShapeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as {
      ruleKind?: ReconciliationRuleKind;
      assignedUnitNumber?: string;
      unitExtractionPattern?: string;
    };
    const kind = o.ruleKind ?? ReconciliationRuleKind.CONCEPT;
    const hasAssign =
      typeof o.assignedUnitNumber === 'string' && o.assignedUnitNumber.length > 0;
    const hasPattern =
      typeof o.unitExtractionPattern === 'string' &&
      o.unitExtractionPattern.length > 0;
    if (kind === ReconciliationRuleKind.UNIT) {
      return hasAssign !== hasPattern; // exactly one
    }
    return !hasAssign && !hasPattern; // CONCEPT carries no unit outcome
  }

  defaultMessage(): string {
    return 'A UNIT rule requires exactly one of assignedUnitNumber or unitExtractionPattern; a CONCEPT rule must set neither.';
  }
}
