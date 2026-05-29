import { Prisma } from '@prisma/client';

/**
 * Recursively converts every `Prisma.Decimal` in a value graph into a JS
 * `number`, so API responses expose numeric money/score fields instead of
 * decimal strings.
 *
 * Prisma's `Decimal.toJSON()` serializes to a string, which silently breaks
 * any consumer that types these fields as `number` (e.g. the web app's strict
 * currency formatter, which renders a fallback dash for non-numeric input).
 * Converting once at the response boundary keeps the wire contract numeric for
 * every endpoint without scattering per-field `.toNumber()` mappings across
 * services.
 *
 * All money columns are at most `Decimal(15,2)` and scores `Decimal(5,4)`,
 * comfortably within `Number.MAX_SAFE_INTEGER`, so `toNumber()` is lossless for
 * transport and display. This mirrors the `Number(...)` coercion the CSV export
 * already performs.
 *
 * Only plain objects and arrays are traversed; `Date`, `Buffer`, and other class
 * instances are returned untouched.
 */
export function serializeDecimals<T>(value: T): T {
  return transform(value) as T;
}

function transform(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (Array.isArray(value)) {
    return value.map(transform);
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = transform(value[key]);
    }
    return result;
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
