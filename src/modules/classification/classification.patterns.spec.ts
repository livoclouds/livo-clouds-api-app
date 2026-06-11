// eslint-disable-next-line @typescript-eslint/no-require-imports
import RE2 = require('re2');
import {
  CONCEPT_PATTERNS,
  PAYER_PATTERNS,
  UNIT_PATTERNS,
} from './classification.service';

/**
 * ENGINE-060 — ReDoS-safety guard for the hardcoded classification passes.
 *
 * User-provided rule patterns are compiled through RE2 (linear-time), but the
 * hardcoded UNIT/CONCEPT/PAYER passes run on the JS backtracking engine. They
 * are safe today; this spec is the guard that keeps a future edit from drifting
 * into a catastrophic-backtracking shape unnoticed.
 *
 * Contract enforced on every hardcoded pattern:
 *  1. It compiles under RE2, OR its ONLY RE2-unsupported construct is the
 *     vetted fixed-width lookahead `(?!\d)` (UNIT_PATTERNS uses it as a
 *     digit-run terminator — constant-time, no backtracking explosion).
 *  2. It contains none of the known dangerous shapes (nested quantifiers).
 *  3. It completes against adversarial 2000-char inputs (the DTO cap for
 *     descriptions) — a catastrophic pattern would hang this suite.
 */

const VETTED_LOOKAHEAD = /\(\?!\\d\)/g;

// Same dangerous shapes the user-rule validator blocks (unit-rule.validators.ts).
const DANGEROUS_SHAPES: RegExp[] = [
  /\([^)]*[+*][^)]*\)\s*[+*]/, // (a+)+, (a*)*, (.+)+
  /\[[^\]]*\][+*]\s*[+*]/, // [a-z]+ +
];

interface NamedPattern {
  name: string;
  regex: RegExp;
}

const ALL_PATTERNS: NamedPattern[] = [
  ...UNIT_PATTERNS.map((p) => ({ name: `UNIT ${p.label}`, regex: p.regex })),
  ...CONCEPT_PATTERNS.map((p) => ({
    name: `CONCEPT ${p.concept}`,
    regex: p.regex,
  })),
  ...PAYER_PATTERNS.map((p, i) => ({ name: `PAYER #${i + 1}`, regex: p })),
];

function compilesUnderRe2(source: string, flags: string): boolean {
  try {
    new RE2(source, flags);
    return true;
  } catch {
    return false;
  }
}

describe('hardcoded classification patterns — ReDoS guard (ENGINE-060)', () => {
  it.each(ALL_PATTERNS.map((p) => [p.name, p] as const))(
    '%s is RE2-compilable or only uses the vetted (?!\\d) lookahead',
    (_name, { regex }) => {
      const re2Flags = regex.flags.replace(/[guy]/g, '');
      if (compilesUnderRe2(regex.source, re2Flags)) return;
      // Not directly RE2-compilable: the only allowed reason is the vetted
      // fixed-width `(?!\d)` terminator. Strip it and require compilability.
      const stripped = regex.source.replace(VETTED_LOOKAHEAD, '');
      expect(stripped).not.toBe(regex.source); // it actually used the construct
      expect(compilesUnderRe2(stripped, re2Flags)).toBe(true);
    },
  );

  it.each(ALL_PATTERNS.map((p) => [p.name, p] as const))(
    '%s contains no dangerous nested-quantifier shape',
    (_name, { regex }) => {
      for (const shape of DANGEROUS_SHAPES) {
        expect(shape.test(regex.source)).toBe(false);
      }
    },
  );

  // Bounded by confirm-import.dto.ts (descriptions ≤ 2000 chars). A pattern that
  // backtracks catastrophically on these would hang/timeout the suite.
  const ADVERSARIAL_INPUTS: string[] = [
    'casa '.repeat(400),
    'c. '.repeat(650),
    '9'.repeat(2000),
    'a'.repeat(2000),
    `nombre: ${'á '.repeat(900)}`,
    `pago de ${'x'.repeat(1990)}`,
    `${'casa 1'.repeat(300)}${'!'.repeat(200)}`,
  ];

  it('every pattern completes against adversarial 2000-char inputs', () => {
    for (const { regex } of ALL_PATTERNS) {
      for (const input of ADVERSARIAL_INPUTS) {
        // Execution completing at all is the assertion (see header comment).
        regex.test(input.slice(0, 2000));
      }
    }
  });
});
