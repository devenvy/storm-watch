import { NhcService } from './nhc.service';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const attrs = {
  idp_source: 'al092026-forecast',
  stormname: 'Hurricane Ida',
  tcdvlp: 'Hurricane',
  maxwind: 100,
  mslp: 960,
  lat: 25.1,
  lon: -80.2,
  tcdir: 315,
  tcspd: 10,
  advisnum: '12A',
  advdate: '1100 AM EDT',
};

/** Answers the forecast-points query of one layer; every other bin is empty. */
function stubLayers(byLayer: Record<number, Response>) {
  const spy = vi.fn<typeof fetch>(async (input) => {
    const layer = Number(/MapServer\/(\d+)\/query/.exec(urlOf(input))?.[1]);
    return byLayer[layer] ?? json({ features: [] });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('NhcService', () => {
  const nhc = new NhcService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries all 15 storm bins and maps the current position', async () => {
    // Layer 6 is AT1, layer 32 is AT2, ...; EP1 is the 6th bin.
    const spy = stubLayers({ 32: json({ features: [{ attributes: attrs }] }) });
    const storms = await nhc.activeStorms();
    expect(spy).toHaveBeenCalledTimes(15);
    expect(storms).toEqual([
      {
        id: 'AL092026',
        name: 'Hurricane Ida',
        classification: 'Hurricane',
        intensityKt: 100,
        pressureMb: 960,
        lat: 25.1,
        lon: -80.2,
        movementDir: 315,
        movementMph: 12,
        advisory: 'Advisory 12A · 1100 AM EDT',
        coneImage:
          'https://www.nhc.noaa.gov/storm_graphics/AT09/refresh/AL092026_5day_cone+png/12A_5day_cone.png',
        advisoryUrl: 'https://www.nhc.noaa.gov/text/MIATCPAT2.shtml',
      },
    ]);
  });

  it('treats the 9999 sentinel as unknown and tolerates a missing id', async () => {
    stubLayers({
      6: json({
        features: [
          { attributes: { ...attrs, idp_source: null, mslp: 9999, tcdir: 9999, tcspd: 9999 } },
        ],
      }),
      // An empty feature list and a feature without attributes are both "no storm".
      32: json({ features: [{ attributes: null }] }),
      58: json({}),
    });
    const [s] = await nhc.activeStorms();
    expect(s).toMatchObject({ id: '', pressureMb: null, movementDir: null, movementMph: null });
  });

  it('fails on HTTP errors', async () => {
    stubLayers({ 6: json({}, 503) });
    await expect(nhc.activeStorms()).rejects.toThrow('NHC 503');
  });

  it('fails on ArcGIS error bodies', async () => {
    stubLayers({ 6: json({ error: { message: 'Invalid layer' } }) });
    await expect(nhc.activeStorms()).rejects.toThrow('NHC: Invalid layer');
  });
});
