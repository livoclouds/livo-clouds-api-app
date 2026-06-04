import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Cap on the serialized recipe so a malformed/huge blob can't bloat a row. */
export const MAX_EXTRACTION_RECIPE_BYTES = 8192;
/** Cap on the number of blocks, mirroring the web builder's node cap. */
export const MAX_EXTRACTION_RECIPE_NODES = 24;

/**
 * Defensive shape check for `extractionRecipe` — the engine-ignored visual block
 * recipe the editor persists so it can faithfully rebuild the block builder on
 * edit. This is metadata, not an outcome: it does NOT participate in the UNIT
 * XOR (see UnitOutcomeShapeConstraint), and the regex it represents is validated
 * separately via SafeRegexConstraint on `unitExtractionPattern`.
 *
 * Accepts `undefined`/`null`. When present, requires an object shaped like
 * `{ nodes: Array (1..24), captureId: string present among node ids }` and a
 * serialized size within MAX_EXTRACTION_RECIPE_BYTES.
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

    // Every node must be an object carrying a non-empty string id and kind.
    const ids = new Set<string>();
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) return false;
      const { id, kind } = node as { id?: unknown; kind?: unknown };
      if (typeof id !== 'string' || id.length === 0) return false;
      if (typeof kind !== 'string' || kind.length === 0) return false;
      ids.add(id);
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
    return 'extractionRecipe must be an object { nodes: [1..24 blocks], captureId } referencing an existing block and at most 8 KB serialized';
  }
}
