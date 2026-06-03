import { isBanBajio, normalizeBankName } from './known-banks';

describe('known-banks', () => {
  describe('isBanBajio', () => {
    it.each(['BanBajío', 'banbajio', 'Banco del Bajío', 'BANCO DEL BAJIO'])(
      'matches "%s"',
      (name) => {
        expect(isBanBajio(name)).toBe(true);
      },
    );

    it.each(['BBVA', 'Santander', 'Banamex', '', null, undefined])(
      'does not match "%s"',
      (name) => {
        expect(isBanBajio(name)).toBe(false);
      },
    );
  });

  it('normalizeBankName lowercases and strips accents', () => {
    expect(normalizeBankName('BanBajío')).toBe('banbajio');
    expect(normalizeBankName(null)).toBe('');
  });
});
