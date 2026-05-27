export type R2KeyScope = 'imports' | 'users' | 'unknown';

export interface ParsedR2Key {
  raw: string;
  scope: R2KeyScope;
  condominiumId: string | null;
  batchId: string | null;
  userId: string | null;
  fileName: string;
  segments: string[];
}

export function parseR2Key(rawKey: string): ParsedR2Key {
  const segments = rawKey.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? rawKey;

  if (
    segments.length >= 4 &&
    segments[0] === 'condominiums' &&
    segments[2] === 'imports'
  ) {
    return {
      raw: rawKey,
      scope: 'imports',
      condominiumId: segments[1] ?? null,
      batchId: segments[3] ?? null,
      userId: null,
      fileName,
      segments,
    };
  }

  if (
    segments.length >= 4 &&
    segments[0] === 'condominiums' &&
    segments[2] === 'users'
  ) {
    return {
      raw: rawKey,
      scope: 'users',
      condominiumId: segments[1] ?? null,
      batchId: null,
      userId: segments[3] ?? null,
      fileName,
      segments,
    };
  }

  if (
    segments.length >= 3 &&
    segments[0] === 'platform' &&
    segments[1] === 'users'
  ) {
    return {
      raw: rawKey,
      scope: 'users',
      condominiumId: null,
      batchId: null,
      userId: segments[2] ?? null,
      fileName,
      segments,
    };
  }

  if (segments.length >= 2 && segments[0] === 'condominiums') {
    return {
      raw: rawKey,
      scope: 'unknown',
      condominiumId: segments[1] ?? null,
      batchId: null,
      userId: null,
      fileName,
      segments,
    };
  }

  return {
    raw: rawKey,
    scope: 'unknown',
    condominiumId: null,
    batchId: null,
    userId: null,
    fileName,
    segments,
  };
}

export function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1 || idx === fileName.length - 1) return '';
  return fileName.slice(idx + 1).toLowerCase();
}
