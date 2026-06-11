import 'reflect-metadata';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { ImportsController } from './imports.controller';

/**
 * ENGINE-007 — the three GET routes expose import batches and a presigned URL
 * to the original bank statement (full account + payer PII). They must stay
 * permission-gated: PermissionsGuard is a no-op for routes without
 * @RequirePermission metadata, so removing a decorator silently re-opens the
 * hole. This spec pins the decorator on every route of the controller.
 */
describe('ImportsController — permission metadata (ENGINE-007)', () => {
  const permissionsOf = (method: keyof ImportsController): string[] | undefined =>
    Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      ImportsController.prototype[method],
    ) as string[] | undefined;

  it.each([
    ['findAll', 'imports.read'],
    ['findOne', 'imports.read'],
    ['download', 'imports.read'],
  ] as const)('GET route %s requires %s', (method, permission) => {
    expect(permissionsOf(method)).toEqual([permission]);
  });

  it.each([
    ['upload', 'imports.create'],
    ['checkHashes', 'imports.create'],
    ['preview', 'imports.create'],
    ['confirm', 'imports.create'],
    ['remove', 'imports.create'],
  ] as const)('write route %s requires %s', (method, permission) => {
    expect(permissionsOf(method)).toEqual([permission]);
  });

  it('every route handler on the controller carries @RequirePermission', () => {
    const handlers = Object.getOwnPropertyNames(
      ImportsController.prototype,
    ).filter(
      (name) =>
        name !== 'constructor' &&
        typeof ImportsController.prototype[name as keyof ImportsController] ===
          'function',
    );
    for (const handler of handlers) {
      expect(permissionsOf(handler as keyof ImportsController)).toBeDefined();
    }
  });
});
