import { parseIdentity } from './identity-parser';

describe('parseIdentity', () => {
  it('parses canonical "casa 47, Juan Pérez"', () => {
    expect(parseIdentity('casa 47, Juan Pérez')).toEqual({
      capturedUnitNumber: '47',
      capturedName: 'Juan Pérez',
    });
  });

  it('parses alphanumeric mid-string unit "Soy de la 47B, mi nombre es María Hernández"', () => {
    expect(parseIdentity('Soy de la 47B, mi nombre es María Hernández')).toEqual({
      capturedUnitNumber: '47B',
      capturedName: 'María Hernández',
    });
  });

  it('parses digits-first "47 Juan García"', () => {
    expect(parseIdentity('47 Juan García')).toEqual({
      capturedUnitNumber: '47',
      capturedName: 'Juan García',
    });
  });

  it('parses pound notation "Pedro López #12"', () => {
    expect(parseIdentity('Pedro López #12')).toEqual({
      capturedUnitNumber: '12',
      capturedName: 'Pedro López',
    });
  });

  it('parses keyword + pound "unidad #3a Carmen Luz Vega"', () => {
    expect(parseIdentity('unidad #3a Carmen Luz Vega')).toEqual({
      capturedUnitNumber: '3A',
      capturedName: 'Carmen Luz Vega',
    });
  });

  it('captures unit but not a one-word name "depto 200, Ana"', () => {
    expect(parseIdentity('depto 200, Ana')).toEqual({
      capturedUnitNumber: '200',
      capturedName: null,
    });
  });

  it('returns nulls for a greeting with no identity "hola"', () => {
    expect(parseIdentity('hola')).toEqual({
      capturedUnitNumber: null,
      capturedName: null,
    });
  });

  it('returns nulls for empty input', () => {
    expect(parseIdentity('')).toEqual({
      capturedUnitNumber: null,
      capturedName: null,
    });
  });

  it('returns nulls for a keyword with no digit "departamento"', () => {
    expect(parseIdentity('departamento')).toEqual({
      capturedUnitNumber: null,
      capturedName: null,
    });
  });

  it('trims surrounding whitespace "  Casa 47   "', () => {
    expect(parseIdentity('  Casa 47   ')).toEqual({
      capturedUnitNumber: '47',
      capturedName: null,
    });
  });

  it('does not throw on non-string input', () => {
    expect(parseIdentity(undefined as unknown as string)).toEqual({
      capturedUnitNumber: null,
      capturedName: null,
    });
  });
});
