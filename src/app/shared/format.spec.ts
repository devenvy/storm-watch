import { compass, ktToMph, miles } from './format';

describe('format', () => {
  it('maps bearings to compass points, wrapping and handling negatives', () => {
    expect(compass(0)).toBe('N');
    expect(compass(22.5)).toBe('NNE');
    expect(compass(180)).toBe('S');
    expect(compass(350)).toBe('N');
    expect(compass(-90)).toBe('W');
    expect(compass(720 + 45)).toBe('NE');
    expect(compass(null)).toBe('');
    expect(compass(undefined)).toBe('');
  });

  it('converts knots to whole mph', () => {
    expect(ktToMph(100)).toBe(115);
    expect(ktToMph(0)).toBe(0);
  });

  it('measures zero distance for the same point', () => {
    expect(miles(31, -85, 31, -85)).toBe(0);
  });
});
