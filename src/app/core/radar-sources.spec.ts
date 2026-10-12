import { RadarSources } from './radar-sources';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const NOW = Date.UTC(2026, 9, 10, 12, 0);
const MIN = 60_000;

function stubFetch(routes: Record<string, () => Response>) {
  const spy = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    return hit ? hit[1]() : json({}, 404);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

const mosaicMeta = () => json({ meta: { valid: new Date(NOW - 2 * MIN).toISOString() } });
const hrrrMeta = () => json({ model_init_utc: new Date(NOW - 60 * MIN).toISOString() });

describe('RadarSources', () => {
  const sources = new RadarSources();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('builds 11 mosaic frames, newest last', async () => {
    stubFetch({ 'USCOMP/n0q_0.json': mosaicMeta });
    const set = await sources.load('mosaic', 'KEOX');
    expect(set.frames).toHaveLength(11);
    expect(set.startIndex).toBe(10);
    expect(set.frames[0]!.url).toContain('nexrad-n0q-900913-m50m/');
    expect(set.frames[10]!.url).toContain('nexrad-n0q-900913/{z}');
    expect(set.frames[10]!.time.getTime()).toBe(NOW - 2 * MIN);
    expect(set.frames[0]!.time.getTime()).toBe(NOW - 52 * MIN);
    expect(set.frames.every((f) => f.kind === 'past')).toBe(true);
  });

  it('lists HRRR forecast frames from just before now to six hours ahead', async () => {
    stubFetch({ 'hrrr/refd_0000.json': hrrrMeta });
    const set = await sources.load('hrrr', 'KEOX');
    expect(set.startIndex).toBe(0);
    expect(set.note).toMatch(/simulated, not observed/);
    // From now-15 min (exclusive) to now+6 h (inclusive), in 15-minute steps.
    expect(set.frames[0]!.time.getTime()).toBe(NOW);
    expect(set.frames.at(-1)!.time.getTime()).toBe(NOW + 360 * MIN);
    expect(set.frames).toHaveLength(25);
    expect(set.frames[0]!.url).toContain('hrrr::REFD-F0060-0');
    expect(set.frames.every((f) => f.kind === 'forecast')).toBe(true);
  });

  it('blends the mosaic with forecast frames after the newest observation', async () => {
    stubFetch({ 'USCOMP/n0q_0.json': mosaicMeta, 'hrrr/refd_0000.json': hrrrMeta });
    const set = await sources.load('blend', 'KEOX');
    expect(set.startIndex).toBe(10);
    expect(set.frames[11]!.kind).toBe('forecast');
    expect(set.frames[11]!.time.getTime()).toBe(NOW);
    expect(set.note).toMatch(/HRRR/);
  });

  it('still shows observed radar when the forecast fails', async () => {
    stubFetch({ 'USCOMP/n0q_0.json': mosaicMeta, 'hrrr/refd_0000.json': () => json({}, 500) });
    const set = await sources.load('blend', 'KEOX');
    expect(set.frames).toHaveLength(11);
    expect(set.note).toBe('Forecast unavailable');
  });

  it('fails when the mosaic metadata is unavailable', async () => {
    stubFetch({ 'USCOMP/n0q_0.json': () => json({}, 502) });
    await expect(sources.load('mosaic', 'KEOX')).rejects.toThrow(/^502 /);
  });

  it('loads single-site reflectivity scans using the 3-letter station id', async () => {
    const spy = stubFetch({
      'radar.py': () =>
        json({ scans: [{ ts: '2026-10-10T11:50:00Z' }, { ts: '2026-10-10T11:55:00Z' }] }),
    });
    const set = await sources.load('site-ref', 'KEOX');
    expect(urlOf(spy.mock.calls[0]![0])).toContain('radar=EOX&product=N0B');
    expect(urlOf(spy.mock.calls[0]![0])).toContain('end=2026-10-10T12:00:00Z');
    expect(set.startIndex).toBe(1);
    expect(set.frames[1]!.url).toContain('ridge::EOX-N0B-202610101155/');
    expect(set.note).toBeUndefined();
  });

  it('labels velocity scans and keeps non-ICAO station ids', async () => {
    const spy = stubFetch({ 'radar.py': () => json({ scans: [{ ts: '2026-10-10T11:55:00Z' }] }) });
    const set = await sources.load('site-vel', 'TLH');
    expect(urlOf(spy.mock.calls[0]![0])).toContain('radar=TLH&product=N0S');
    expect(set.note).toMatch(/rotation/);
  });

  it('fails when a site has no recent scans', async () => {
    stubFetch({ 'radar.py': () => json({ scans: [] }) });
    await expect(sources.load('site-ref', 'KEOX')).rejects.toThrow('No recent N0B scans from KEOX');
  });

  it('maps RainViewer frames and caps the native zoom', async () => {
    stubFetch({
      rainviewer: () =>
        json({
          host: 'https://tilecache.rainviewer.com',
          radar: { past: [{ time: 1_760_000_000, path: '/v2/radar/abc' }] },
        }),
    });
    const set = await sources.load('rainviewer', 'KEOX');
    expect(set.maxNativeZoom).toBe(7);
    expect(set.frames[0]).toEqual({
      time: new Date(1_760_000_000_000),
      url: 'https://tilecache.rainviewer.com/v2/radar/abc/256/{z}/{x}/{y}/2/1_1.png',
      kind: 'past',
    });
  });

  it('returns no frames for the image-only source', async () => {
    await expect(sources.load('site-gif', 'KEOX')).resolves.toEqual({
      frames: [],
      startIndex: 0,
    });
  });
});
