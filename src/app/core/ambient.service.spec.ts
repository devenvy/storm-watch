import { parseStations, STALE_MS } from './ambient.service';
import { miles } from '../shared/format';

const NOW = Date.UTC(2026, 9, 10, 2);
const dev = (
  id: string,
  lat: number,
  lon: number,
  at: number,
  extra: Record<string, unknown> = {},
) => ({
  _id: id,
  macAddress: 'AA:BB',
  info: {
    name: ` ${id} `,
    coords: { coords: { lat, lon }, location: 'Dothan', address: '1 Main St' },
  },
  lastData: { dateutc: at, tempf: 70, windgustmph: 20, dailyrainin: 1.2, humidityin: 40, ...extra },
});

describe('parseStations', () => {
  it('keeps active stations with outdoor data, nearest first, without private fields', () => {
    const out = parseStations(
      {
        data: [
          dev('far', 31.5, -85.4, NOW - 60_000),
          dev('near', 31.23, -85.39, NOW - 120_000),
          dev('stale', 31.22, -85.39, NOW - STALE_MS - 1),
          dev('notemp', 31.22, -85.39, NOW, { tempf: undefined }),
          dev('junk', 31.22, -85.39, NOW, { tempf: 'hot' }),
          { _id: 'nocoords', lastData: { dateutc: NOW, tempf: 70 } },
        ],
      },
      31.22,
      -85.39,
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(['near', 'far']);
    expect(out[0]!.name).toBe('near');
    expect(out[0]!.rainTodayIn).toBe(1.2);
    expect(Object.keys(out[0]!)).not.toContain('macAddress');
    expect(JSON.stringify(out)).not.toContain('Main St');
  });

  it('rejects an unexpected body', () => {
    expect(() => parseStations({ error: 'x' }, 0, 0)).toThrow();
  });

  it('measures miles', () => {
    expect(miles(31, -85, 32, -85)).toBeCloseTo(69.1, 0);
  });
});
