import { num, str, webUrl } from './guards';

describe('guards', () => {
  it('str accepts short strings only', () => {
    expect(str('abc')).toBe(true);
    expect(str('abc', 2)).toBe(false);
    expect(str(3)).toBe(false);
  });

  it('num accepts finite numbers in range', () => {
    expect(num(5, 0, 10)).toBe(true);
    expect(num(-1, 0, 10)).toBe(false);
    expect(num(11, 0, 10)).toBe(false);
    expect(num(Number.NaN, 0, 10)).toBe(false);
    expect(num(Infinity, 0, Infinity)).toBe(false);
    expect(num('5', 0, 10)).toBe(false);
  });

  it('webUrl accepts only http(s) URLs of sane length', () => {
    expect(webUrl('https://example.com/a')).toBe(true);
    expect(webUrl('http://example.com')).toBe(true);
    expect(webUrl('ftp://example.com')).toBe(false);
    expect(webUrl('not a url')).toBe(false);
    expect(webUrl(`https://example.com/${'a'.repeat(2000)}`)).toBe(false);
    expect(webUrl(null)).toBe(false);
  });
});
