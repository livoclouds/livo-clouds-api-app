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
