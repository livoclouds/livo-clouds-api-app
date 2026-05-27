import { fileExtension, parseR2Key } from '../key-parser';

describe('parseR2Key', () => {
  it('parses an imports key', () => {
    const result = parseR2Key(
      'condominiums/cond-abc/imports/batch-xyz/statement_2024.xlsx',
    );
    expect(result.scope).toBe('imports');
    expect(result.condominiumId).toBe('cond-abc');
    expect(result.batchId).toBe('batch-xyz');
    expect(result.fileName).toBe('statement_2024.xlsx');
  });

  it('falls back to unknown scope when only condominium prefix is present', () => {
    const result = parseR2Key('condominiums/cond-abc/avatars/user-1.png');
    expect(result.scope).toBe('unknown');
    expect(result.condominiumId).toBe('cond-abc');
    expect(result.batchId).toBeNull();
    expect(result.fileName).toBe('user-1.png');
  });

  it('returns unknown scope with no condominium for foreign keys', () => {
    const result = parseR2Key('public/marketing/logo.png');
    expect(result.scope).toBe('unknown');
    expect(result.condominiumId).toBeNull();
    expect(result.batchId).toBeNull();
    expect(result.fileName).toBe('logo.png');
  });

  it('handles trailing slashes and empty segments', () => {
    const result = parseR2Key('//condominiums//cond-1//imports//batch-2//x.pdf');
    expect(result.scope).toBe('imports');
    expect(result.condominiumId).toBe('cond-1');
    expect(result.batchId).toBe('batch-2');
    expect(result.fileName).toBe('x.pdf');
  });

  it('parses a tenant-scoped user avatar key', () => {
    const result = parseR2Key(
      'condominiums/cond-abc/users/user-7/avatar-1700000000000.png',
    );
    expect(result.scope).toBe('users');
    expect(result.condominiumId).toBe('cond-abc');
    expect(result.userId).toBe('user-7');
    expect(result.fileName).toBe('avatar-1700000000000.png');
  });

  it('parses a platform user avatar key (ROOT users without condominium)', () => {
    const result = parseR2Key('platform/users/user-root/avatar-1.webp');
    expect(result.scope).toBe('users');
    expect(result.condominiumId).toBeNull();
    expect(result.userId).toBe('user-root');
    expect(result.fileName).toBe('avatar-1.webp');
  });
});

describe('fileExtension', () => {
  it('returns lowercase extension', () => {
    expect(fileExtension('Statement.XLSX')).toBe('xlsx');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns empty string when no extension', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
  });
});
