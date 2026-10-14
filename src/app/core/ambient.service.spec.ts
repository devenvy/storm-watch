import { AmbientService, parseStations, STALE_MS } from './ambient.service';
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
    expect(() => parseStations({ error: 'x' }, 0, 0)).toThrow('Unexpected Ambient response');
  });

  it('measures miles', () => {
    expect(miles(31, -85, 32, -85)).toBeCloseTo(69.1, 0);
  });
});

describe('AmbientService.nearby', () => {
  const urlOf = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') {
      return input;
    }
    return input instanceof URL ? input.href : input.url;
  };
  const ambient = new AmbientService();
  const list = (n: number) =>
    Array.from({ length: n }, (_, i) => dev(`s${i}`, 31.2 + i / 100, -85.39, Date.now() - 1000));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops at the small box when enough stations report', async () => {
    const spy = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: list(6) })));
    vi.stubGlobal('fetch', spy);
    const out = await ambient.nearby(31.2, -85.39);
    expect(out).toHaveLength(6);
    expect(spy).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(urlOf(spy.mock.calls[0]![0]));
    expect(url).toContain('$publicBox[0][1]=31.05');
    expect(url).toContain('$limit=500');
  });

  it('widens the search when few stations report and caps the result count', async () => {
    const spy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: list(2) })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: list(14) })));
    vi.stubGlobal('fetch', spy);
    const out = await ambient.nearby(31.2, -85.39);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(10);
    expect(out[0]!.id).toBe('s0');
  });

  it('returns what the wide box found even when it is fewer than wanted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: list(1) }))),
    );
    await expect(ambient.nearby(31.2, -85.39)).resolves.toHaveLength(1);
  });

  it('fails on HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('', { status: 429 })),
    );
    await expect(ambient.nearby(31.2, -85.39)).rejects.toThrow('Ambient 429');
  });
});

describe('parseStations edge cases', () => {
  it('skips null devices, bad ids and out-of-range readings, and defaults blank names', () => {
    const blank = dev('blank', 31.22, -85.39, NOW, {
      humidity: 150,
      baromrelin: 29.9234,
      hourlyrainin: 0.456,
    });
    blank.info.name = '   ';
    const out = parseStations(
      {
        data: [
          null,
          dev('x'.repeat(65), 31.22, -85.39, NOW),
          dev('future', 31.22, -85.39, NOW + 10 * 60_000),
          dev('badlat', 95, -85.39, NOW),
          { _id: 'nodata', info: { coords: { coords: { lat: 31, lon: -85 } } } },
          blank,
        ],
      },
      31.22,
      -85.39,
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(['blank']);
    expect(out[0]).toMatchObject({
      name: 'Weather station',
      place: 'Dothan',
      humidity: null,
      pressureInHg: 29.92,
      rainRateIn: 0.46,
    });
  });

  it('rejects a null body', () => {
    expect(() => parseStations(null, 0, 0)).toThrow('Unexpected Ambient response');
  });
});
