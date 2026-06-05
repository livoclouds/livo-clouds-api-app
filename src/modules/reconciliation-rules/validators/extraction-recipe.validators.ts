import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Cap on the serialized recipe so a malformed/huge blob can't bloat a row. */
export const MAX_EXTRACTION_RECIPE_BYTES = 8192;
/** Cap on the number of blocks, mirroring the web builder's node cap. */
export const MAX_EXTRACTION_RECIPE_NODES = 24;

// The following MUST stay in sync with the web BlockRecipe model
// (web: …/UnitBlockBuilder/types.ts — UNIT_BLOCK_KINDS, SEPARATOR_STYLES, BLOCK_CAPS).
const VALID_KINDS = ['literal', 'digits', 'letters', 'alnum', 'separator', 'anyOf'] as const;
const VALID_SEPARATOR_STYLES = ['space', 'dash', 'hash', 'dot', 'slash', 'flexible'] as const;
const NUMERIC_CAPS: Record<string, { min: number; max: number }> = {
  digits: { min: 1, max: 12 },
  letters: { min: 1, max: 6 },
  alnum: { min: 1, max: 16 },
};

function isValidNode(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const node = raw as Record<string, unknown>;
  const { id, kind } = node;
  if (typeof id !== 'string' || id.length === 0) return false;
  if (typeof kind !== 'string' || !(VALID_KINDS as readonly string[]).includes(kind)) {
    return false;
  }
  switch (kind) {
    case 'literal':
      return typeof node.text === 'string';
    case 'digits':
    case 'letters':
    case 'alnum': {
      const cap = NUMERIC_CAPS[kind];
      const { min, max } = node;
      return (
        typeof min === 'number' &&
        typeof max === 'number' &&
        Number.isInteger(min) &&
        Number.isInteger(max) &&
        min >= cap.min &&
        max <= cap.max &&
        min <= max
      );
    }
    case 'separator':
      return (
        typeof node.style === 'string' &&
        (VALID_SEPARATOR_STYLES as readonly string[]).includes(node.style)
      );
    case 'anyOf':
      return (
        Array.isArray(node.options) &&
        node.options.every((o) => typeof o === 'string')
      );
    default:
      return false;
  }
}

/**
 * Defensive shape check for `extractionRecipe` — the engine-ignored visual block
 * recipe the editor persists so it can faithfully rebuild the block builder on
 * edit. This is metadata, not an outcome: it does NOT participate in the UNIT
 * XOR (see UnitOutcomeShapeConstraint), and the regex it represents is validated
 * separately via SafeRegexConstraint on `unitExtractionPattern`.
 *
 * Accepts `undefined`/`null`. When present, requires an object
 * `{ nodes: Array (1..24), captureId }` where `captureId` references a node id,
 * every node matches the web BlockRecipe model (valid `kind`, in-range numeric
 * bounds, valid separator style), and the serialized size is within
 * MAX_EXTRACTION_RECIPE_BYTES. Mirrors the web validator so a recipe accepted on
 * one side is accepted on the other.
 */
@ValidatorConstraint({ name: 'extractionRecipeShape', async: false })
export class ExtractionRecipeShapeConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;

    const recipe = value as { nodes?: unknown; captureId?: unknown };
    const { nodes, captureId } = recipe;

    if (!Array.isArray(nodes)) return false;
    if (nodes.length < 1 || nodes.length > MAX_EXTRACTION_RECIPE_NODES) {
      return false;
    }
    if (typeof captureId !== 'string' || captureId.length === 0) return false;

    // Every node must match the web BlockRecipe model (valid kind + bounds).
    const ids = new Set<string>();
    for (const node of nodes) {
      if (!isValidNode(node)) return false;
      ids.add((node as { id: string }).id);
    }
    // The capture target must reference an existing block.
    if (!ids.has(captureId)) return false;

    try {
      if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_EXTRACTION_RECIPE_BYTES) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  defaultMessage(): string {
    return 'extractionRecipe must be an object { nodes: [1..24 valid blocks], captureId } referencing an existing block and at most 8 KB serialized';
  }
}
