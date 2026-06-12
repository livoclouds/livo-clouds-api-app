import { ValidationArguments } from 'class-validator';
import {
  SafeRegexConstraint,
  SafeTriggerPatternConstraint,
  UnitOutcomeShapeConstraint,
  MAX_EXTRACTION_PATTERN_LENGTH,
} from './unit-rule.validators';

function args(value: unknown, object: Record<string, unknown>): ValidationArguments {
  return {
    value,
    constraints: [],
    targetName: 'CreateReconciliationRuleDto',
    object,
    property: 'unitExtractionPattern',
  };
}

describe('SafeRegexConstraint', () => {
  const c = new SafeRegexConstraint();

  it('accepts a valid pattern whose capture group exists', () => {
    expect(c.validate('apt-(\\d+)', args('apt-(\\d+)', { unitExtractionGroup: 1 }))).toBe(true);
  });

  it('accepts a higher capture-group index that exists', () => {
    const p = '(torre [a-z])-(\\d+)';
    expect(c.validate(p, args(p, { unitExtractionGroup: 2 }))).toBe(true);
  });

  it('rejects a group index beyond the captured groups', () => {
    expect(c.validate('apt-(\\d+)', args('apt-(\\d+)', { unitExtractionGroup: 3 }))).toBe(false);
  });

  it('rejects an invalid regex', () => {
    expect(c.validate('([unterminated', args('([unterminated', {}))).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(c.validate('', args('', {}))).toBe(false);
  });

  it('rejects an over-long pattern', () => {
    const long = `a(${'b'.repeat(MAX_EXTRACTION_PATTERN_LENGTH)})`;
    expect(c.validate(long, args(long, { unitExtractionGroup: 1 }))).toBe(false);
  });

  it('rejects an obvious catastrophic-backtracking shape', () => {
    const evil = '(a+)+(\\d+)';
    expect(c.validate(evil, args(evil, { unitExtractionGroup: 2 }))).toBe(false);
  });

  it('defaults the group to 1 when unset', () => {
    expect(c.validate('apt-(\\d+)', args('apt-(\\d+)', {}))).toBe(true);
  });

  it('rejects an RE2-unsupported pattern (lookahead) the engine could not run', () => {
    // Valid in JS RegExp but RE2 has no lookaround — reject at save time so it
    // never becomes a rule that silently never fires.
    const p = '(?=apt)apt-(\\d+)';
    expect(c.validate(p, args(p, { unitExtractionGroup: 1 }))).toBe(false);
  });

  it('rejects an RE2-unsupported pattern (backreference)', () => {
    const p = '(a)\\1-(\\d+)';
    expect(c.validate(p, args(p, { unitExtractionGroup: 2 }))).toBe(false);
  });
});

describe('UnitOutcomeShapeConstraint', () => {
  const c = new UnitOutcomeShapeConstraint();
  const on = (object: Record<string, unknown>) => c.validate(object.name, args(object.name, object));

  it('CONCEPT rule with no unit outcome is valid', () => {
    expect(on({ name: 'r', ruleKind: 'CONCEPT', conceptType: 'MAINTENANCE' })).toBe(true);
  });

  it('CONCEPT rule carrying a unit outcome is invalid', () => {
    expect(on({ name: 'r', ruleKind: 'CONCEPT', assignedUnitNumber: '5' })).toBe(false);
  });

  it('UNIT rule with exactly one outcome (assignment) is valid', () => {
    expect(on({ name: 'r', ruleKind: 'UNIT', assignedUnitNumber: '5' })).toBe(true);
  });

  it('UNIT rule with exactly one outcome (extraction) is valid', () => {
    expect(on({ name: 'r', ruleKind: 'UNIT', unitExtractionPattern: 'apt-(\\d+)' })).toBe(true);
  });

  it('UNIT rule with both outcomes is invalid', () => {
    expect(
      on({ name: 'r', ruleKind: 'UNIT', assignedUnitNumber: '5', unitExtractionPattern: 'apt-(\\d+)' }),
    ).toBe(false);
  });

  it('UNIT rule with no outcome is invalid', () => {
    expect(on({ name: 'r', ruleKind: 'UNIT' })).toBe(false);
  });

  it('defaults to CONCEPT when ruleKind is omitted', () => {
    expect(on({ name: 'r' })).toBe(true);
    expect(on({ name: 'r', assignedUnitNumber: '5' })).toBe(false);
  });
});

describe('SafeTriggerPatternConstraint (ENGINE-041)', () => {
  const c = new SafeTriggerPatternConstraint();

  it('accepts a plain trigger with NO capture group (the differentiator vs SafeRegexConstraint)', () => {
    expect(c.validate('casa\\s*\\d+')).toBe(true);
    expect(c.validate('mantenimiento')).toBe(true);
  });

  it('rejects RE2-unsupported syntax that would silently never fire (lookahead/backreference)', () => {
    expect(c.validate('casa(?=\\d)')).toBe(false);
    expect(c.validate('(\\d+)-\\1')).toBe(false);
  });

  it('rejects catastrophic-backtracking shapes early with a friendly message', () => {
    expect(c.validate('(a+)+')).toBe(false);
    expect(c.validate('([a-z]*)*')).toBe(false);
  });

  it('rejects empty, non-string, and over-long entries', () => {
    expect(c.validate('')).toBe(false);
    expect(c.validate(42)).toBe(false);
    expect(c.validate('a'.repeat(MAX_EXTRACTION_PATTERN_LENGTH + 1))).toBe(false);
  });
});
