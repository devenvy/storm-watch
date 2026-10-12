import { type NwsAlert, NwsService } from './nws.service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const urlOf = (input: RequestInfo | URL | undefined): string => {
  if (input === undefined || typeof input === 'string') {
    return input ?? '';
  }
  return input instanceof URL ? input.href : input.url;
};

/** Routes fetch calls by URL substring; unmatched URLs fail with 404. */
function stubFetch(routes: Record<string, unknown>) {
  const spy = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) {
      return json({}, 404);
    }
    const [, value] = hit;
    if (value instanceof Error) {
      throw value;
    }
    return value instanceof Response ? value : json(value);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

const alertProps = (id: string, severity: NwsAlert['severity']) => ({
  id,
  event: 'Flood Watch',
  severity,
  headline: id,
});

describe('NwsService', () => {
  const nws = new NwsService();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reads point metadata and rounds the coordinates', async () => {
    const spy = stubFetch({
      '/points/': {
        properties: {
          cwa: 'TAE',
          radarStation: 'KEOX',
          observationStations: 'https://api.weather.gov/gridpoints/TAE/1,2/stations',
          relativeLocation: { properties: { city: 'Dothan', state: 'AL' } },
        },
      },
    });
    await expect(nws.point(31.123456, -85.987654)).resolves.toEqual({
      city: 'Dothan',
      state: 'AL',
      office: 'TAE',
      radarStation: 'KEOX',
      stationsUrl: 'https://api.weather.gov/gridpoints/TAE/1,2/stations',
    });
    expect(urlOf(spy.mock.calls[0]?.[0])).toBe('https://api.weather.gov/points/31.1235,-85.9877');
  });

  it('falls back to empty city/state when the relative location is missing', async () => {
    stubFetch({
      '/points/': { properties: { cwa: 'TAE', radarStation: 'KEOX', observationStations: 'x' } },
    });
    const p = await nws.point(1, 2);
    expect(p.city).toBe('');
    expect(p.state).toBe('');
  });

  it('throws on HTTP errors', async () => {
    stubFetch({ '/points/': json({}, 500) });
    await expect(nws.point(1, 2)).rejects.toThrow(/NWS 500/);
  });

  it('sorts alerts by severity with unknown severities last', async () => {
    stubFetch({
      '/alerts/active?point=': {
        features: [
          { properties: alertProps('minor', 'Minor'), geometry: null },
          { properties: alertProps('unknown', 'Unknown'), geometry: null },
          { properties: alertProps('extreme', 'Extreme'), geometry: null },
          { properties: alertProps('moderate', 'Moderate'), geometry: null },
          { properties: alertProps('severe', 'Severe'), geometry: null },
        ],
      },
    });
    const list = await nws.alertsAt(31, -85);
    expect(list.map((a) => a.id)).toEqual(['extreme', 'severe', 'moderate', 'minor', 'unknown']);
  });

  it('keeps only warning shapes that have a geometry', async () => {
    const geometry = { type: 'Point', coordinates: [1, 2] };
    const spy = stubFetch({
      'status=actual': {
        features: [
          { properties: { event: 'Tornado Warning', headline: 'h1' }, geometry },
          { properties: { event: 'Flash Flood Warning', headline: 'h2' }, geometry: null },
        ],
      },
    });
    await expect(nws.warningShapes()).resolves.toEqual([
      { event: 'Tornado Warning', headline: 'h1', geometry },
    ]);
    expect(urlOf(spy.mock.calls[0]?.[0])).toContain('Tornado%20Warning');
  });

  describe('latestObservation', () => {
    const NOW = Date.UTC(2026, 9, 10, 12);
    const station = (id: string, lat: number, lon: number | null) => ({
      properties: { stationIdentifier: id, name: `${id} name` },
      geometry: lon === null ? null : { coordinates: [lon, lat] },
    });
    const obs = (ageMs: number, temperature: number | null, extra: object = {}) => ({
      properties: {
        timestamp: new Date(NOW - ageMs).toISOString(),
        textDescription: 'Cloudy',
        temperature: { value: temperature },
        ...extra,
      },
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });

    it('uses the nearest fresh station and converts units', async () => {
      stubFetch({
        '/stations-list': {
          features: [station('FAR', 32, -85), station('NEAR', 31.01, -85)],
        },
        '/stations/NEAR/observations/latest': obs(60_000, 20, {
          heatIndex: { value: 30 },
          relativeHumidity: { value: 55.4 },
          windSpeed: { value: 16.0934 },
          windGust: { value: null },
          windDirection: { value: 180 },
          barometricPressure: { value: 101_325 },
        }),
      });
      const o = await nws.latestObservation('https://api.weather.gov/stations-list', 31, -85);
      expect(o).toMatchObject({
        station: 'NEAR',
        stationName: 'NEAR name',
        text: 'Cloudy',
        tempF: 68,
        feelsLikeF: 86,
        humidity: 55,
        windMph: 10,
        gustMph: null,
        windDir: 180,
        pressureInHg: 29.92,
      });
      expect(o.distanceMi).toBeCloseTo(0.69, 1);
    });

    it('skips failing and stale stations but remembers the first answer as a fallback', async () => {
      stubFetch({
        '/stations-list': {
          features: [station('A', 31, -85), station('B', 31.1, -85), station('C', 31.2, -85)],
        },
        '/stations/A/': new Error('offline'),
        '/stations/B/': obs(10 * 3_600_000, 15),
        '/stations/C/': obs(0, null),
      });
      const o = await nws.latestObservation('https://api.weather.gov/stations-list', 31, -85);
      // No station is both fresh and has a temperature, so the first responder (B) is used.
      expect(o.station).toBe('B');
      expect(o.tempF).toBe(59);
      expect(o.feelsLikeF).toBe(59);
      expect(o.humidity).toBeNull();
      expect(o.windMph).toBeNull();
      expect(o.windDir).toBeNull();
      expect(o.pressureInHg).toBeNull();
    });

    it('prefers a later fresh station over an earlier stale one', async () => {
      stubFetch({
        '/stations-list': { features: [station('A', 31, -85), station('B', 31.1, -85)] },
        '/stations/A/': obs(0, null),
        '/stations/B/': obs(0, 10, { windChill: { value: 5 } }),
      });
      const o = await nws.latestObservation('https://api.weather.gov/stations-list', 31, -85);
      expect(o.station).toBe('B');
      expect(o.feelsLikeF).toBe(41);
    });

    it('reports an unknown distance for stations without coordinates', async () => {
      stubFetch({
        '/stations-list': { features: [station('X', 0, null)] },
        '/stations/X/': obs(0, 0),
      });
      const o = await nws.latestObservation('https://api.weather.gov/stations-list', 31, -85);
      expect(o.distanceMi).toBeNull();
      expect(o.tempF).toBe(32);
    });

    it('throws when no station reports', async () => {
      stubFetch({
        '/stations-list': { features: [station('A', 31, -85)] },
        '/stations/A/': new Error('down'),
      });
      await expect(
        nws.latestObservation('https://api.weather.gov/stations-list', 31, -85),
      ).rejects.toThrow(/No NWS station/);
    });
  });
});
