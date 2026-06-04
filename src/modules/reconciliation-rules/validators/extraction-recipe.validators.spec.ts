import {
  ExtractionRecipeShapeConstraint,
  MAX_EXTRACTION_RECIPE_NODES,
} from './extraction-recipe.validators';

const c = new ExtractionRecipeShapeConstraint();

function node(id: string, kind = 'digits') {
  return { id, kind, min: 1, max: 3, optional: false };
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
});
