import {
  ExtractionRecipeShapeConstraint,
  MAX_EXTRACTION_RECIPE_NODES,
} from './extraction-recipe.validators';

const c = new ExtractionRecipeShapeConstraint();

/** Build a valid node of the given kind (matches the web BlockRecipe model). */
function node(id: string, kind = 'digits') {
  switch (kind) {
    case 'literal':
      return { id, kind, optional: false, text: 'APT' };
    case 'separator':
      return { id, kind, optional: false, style: 'dash' };
    case 'anyOf':
      return { id, kind, optional: false, options: ['casa', 'cs'] };
    default: // digits | letters | alnum
      return { id, kind, optional: false, min: 1, max: 3 };
  }
}

describe('ExtractionRecipeShapeConstraint', () => {
  it('accepts undefined (optional field)', () => {
    expect(c.validate(undefined)).toBe(true);
  });

  it('accepts null', () => {
    expect(c.validate(null)).toBe(true);
  });

  it('accepts a well-formed recipe whose captureId references a node', () => {
    const recipe = {
      nodes: [node('a', 'literal'), node('b', 'digits')],
      captureId: 'b',
    };
    expect(c.validate(recipe)).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(c.validate('nope')).toBe(false);
    expect(c.validate(42)).toBe(false);
  });

  it('rejects an array', () => {
    expect(c.validate([node('a')])).toBe(false);
  });

  it('rejects when nodes is missing or not an array', () => {
    expect(c.validate({ captureId: 'a' })).toBe(false);
    expect(c.validate({ nodes: 'x', captureId: 'a' })).toBe(false);
  });

  it('rejects an empty node list', () => {
    expect(c.validate({ nodes: [], captureId: 'a' })).toBe(false);
  });

  it('rejects more nodes than the cap', () => {
    const nodes = Array.from({ length: MAX_EXTRACTION_RECIPE_NODES + 1 }, (_, i) =>
      node(`n${i}`),
    );
    expect(c.validate({ nodes, captureId: 'n0' })).toBe(false);
  });

  it('rejects a captureId that does not reference any node', () => {
    expect(c.validate({ nodes: [node('a')], captureId: 'zzz' })).toBe(false);
  });

  it('rejects an empty captureId', () => {
    expect(c.validate({ nodes: [node('a')], captureId: '' })).toBe(false);
  });

  it('rejects a node without a string id or kind', () => {
    expect(c.validate({ nodes: [{ kind: 'digits' }], captureId: 'a' })).toBe(false);
    expect(c.validate({ nodes: [{ id: 'a' }], captureId: 'a' })).toBe(false);
  });

  it('rejects a recipe whose serialized size exceeds the byte cap', () => {
    const huge = {
      nodes: [{ id: 'a', kind: 'literal', text: 'x'.repeat(9000), optional: false }],
      captureId: 'a',
    };
    expect(c.validate(huge)).toBe(false);
  });

  it('accepts every valid node kind', () => {
    const recipe = {
      nodes: [
        node('a', 'literal'),
        node('b', 'separator'),
        node('c', 'letters'),
        node('d', 'alnum'),
        node('e', 'anyOf'),
        node('f', 'digits'),
      ],
      captureId: 'f',
    };
    expect(c.validate(recipe)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'wildcard', optional: false }], captureId: 'a' }),
    ).toBe(false);
  });

  it('rejects a separator with an unknown style', () => {
    expect(
      c.validate({
        nodes: [{ id: 'a', kind: 'separator', optional: false, style: 'bogus' }],
        captureId: 'a',
      }),
    ).toBe(false);
  });

  it('rejects a literal without a text string', () => {
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'literal', optional: false }], captureId: 'a' }),
    ).toBe(false);
  });

  it('rejects numeric blocks out of range or with min > max', () => {
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'digits', min: 1, max: 99 }], captureId: 'a' }),
    ).toBe(false); // max beyond the 12 cap
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'digits', min: 5, max: 2 }], captureId: 'a' }),
    ).toBe(false); // min > max
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'letters', min: 0, max: 3 }], captureId: 'a' }),
    ).toBe(false); // min below the 1 cap
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'digits', min: 1.5, max: 3 }], captureId: 'a' }),
    ).toBe(false); // non-integer
  });

  it('rejects an anyOf whose options are not all strings', () => {
    expect(
      c.validate({ nodes: [{ id: 'a', kind: 'anyOf', options: ['ok', 3] }], captureId: 'a' }),
    ).toBe(false);
  });
});
