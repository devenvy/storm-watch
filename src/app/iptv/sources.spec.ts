import {
  diagnosedFetch,
  m3uChannels,
  parseM3u,
  SourceError,
  xtreamChannels,
  xtreamLogin,
  xtreamNowPlaying,
} from './sources';

import type { XtreamSource } from './models';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const xt: XtreamSource = {
  kind: 'xtream',
  server: ' http://tv.example:8080// ',
  username: 'u s',
  password: 'p&w',
  format: 'm3u8',
};

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe('diagnosedFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response when the fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json({ ok: 1 })));
    const r = await diagnosedFetch('http://tv.example/x');
    await expect(r.json()).resolves.toEqual({ ok: 1 });
  });

  it('diagnoses a missing CORS header when a no-cors probe gets through', async () => {
    const spy = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const err = await diagnosedFetch('http://tv.example/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as Error).message).toMatch(/no CORS header/);
    expect(spy).toHaveBeenLastCalledWith('http://tv.example/x', { mode: 'no-cors' });
  });

  it('diagnoses an unreachable provider', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('x')));
    await expect(diagnosedFetch('http://tv.example/x')).rejects.toThrow(/Provider unreachable/);
  });

  it('rejects invalid URLs', async () => {
    await expect(diagnosedFetch('not a url')).rejects.toThrow(TypeError);
  });
});

describe('xtreamLogin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the API URL and maps the account', async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        user_info: {
          auth: 1,
          status: 'Active',
          max_connections: '2',
          active_cons: 1,
          allowed_output_formats: ['m3u8', 'ts'],
          exp_date: '1800000000',
        },
      }),
    );
    vi.stubGlobal('fetch', spy);
    const acct = await xtreamLogin(xt);
    expect(urlOf(spy.mock.calls[0]![0])).toBe(
      'http://tv.example:8080/player_api.php?username=u%20s&password=p%26w',
    );
    expect(acct).toEqual({
      status: 'Active',
      maxConnections: 2,
      activeConnections: 1,
      formats: ['m3u8', 'ts'],
      expires: new Date(1_800_000_000_000),
    });
  });

  it('defaults formats and expiry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(json({ user_info: { status: 'Active' } })),
    );
    const acct = await xtreamLogin(xt);
    expect(acct.formats).toEqual(['ts']);
    expect(acct.expires).toBeNull();
  });

  it('rejects bad credentials and HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ user_info: { auth: 0, status: 'Disabled' } }))
        .mockResolvedValueOnce(json({}))
        .mockResolvedValueOnce(json({}, 403)),
    );
    await expect(xtreamLogin(xt)).rejects.toThrow(/Login rejected/);
    await expect(xtreamLogin(xt)).rejects.toThrow(/Login rejected/);
    await expect(xtreamLogin(xt)).rejects.toThrow('Login failed: HTTP 403');
  });
});

describe('xtreamChannels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('joins streams with their categories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        urlOf(input).includes('get_live_categories')
          ? json([{ category_id: 5, category_name: 'News' }])
          : json([
              {
                stream_id: 42,
                name: ' WSFA 12 ',
                stream_icon: 'http://logo/x.png',
                category_id: '5',
                epg_channel_id: 'wsfa.us',
              },
              { stream_id: 43, name: null, stream_icon: '', category_id: 9, epg_channel_id: '' },
            ]),
      ),
    );
    const list = await xtreamChannels(xt);
    expect(list).toEqual([
      {
        key: 'x42',
        name: 'WSFA 12',
        url: 'http://tv.example:8080/live/u%20s/p%26w/42.m3u8',
        logo: 'http://logo/x.png',
        category: 'News',
        epgId: 'wsfa.us',
        streamId: 42,
      },
      {
        key: 'x43',
        name: '',
        url: 'http://tv.example:8080/live/u%20s/p%26w/43.m3u8',
        logo: undefined,
        category: undefined,
        epgId: undefined,
        streamId: 43,
      },
    ]);
  });
});

describe('xtreamNowPlaying', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes base64 UTF-8 listings', async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        epg_listings: [
          {
            title: b64('Café News'),
            description: b64('Live'),
            start_timestamp: '1700000000',
            stop_timestamp: 1700003600,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', spy);
    const n = await xtreamNowPlaying(xt, 42);
    expect(urlOf(spy.mock.calls[0]![0])).toContain('action=get_short_epg&stream_id=42&limit=1');
    expect(n).toEqual({
      title: 'Café News',
      description: 'Live',
      start: new Date(1_700_000_000_000),
      end: new Date(1_700_003_600_000),
    });
  });

  it('keeps undecodable text and handles missing fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ epg_listings: [{ title: '%%%', start_timestamp: 0, stop_timestamp: 0 }] }),
        ),
    );
    const n = await xtreamNowPlaying(xt, 1);
    expect(n?.title).toBe('%%%');
    expect(n?.description).toBe('');
  });

  it('returns null without listings', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json({})));
    await expect(xtreamNowPlaying(xt, 1)).resolves.toBeNull();
  });
});

describe('m3uChannels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads and parses the playlist', async () => {
    const spy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('#EXTM3U\n#EXTINF:-1,One\nhttp://a/1.ts\n'));
    vi.stubGlobal('fetch', spy);
    const list = await m3uChannels({ kind: 'm3u', url: ' http://a/list.m3u ' });
    expect(urlOf(spy.mock.calls[0]![0])).toBe('http://a/list.m3u');
    expect(list.map((c) => c.name)).toEqual(['One']);
  });

  it('reports HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
    );
    await expect(m3uChannels({ kind: 'm3u', url: 'http://a/x' })).rejects.toThrow(
      'Playlist failed: HTTP 404',
    );
  });
});

describe('parseM3u', () => {
  it('skips directives between #EXTINF and the URL and falls back to tvg-name', () => {
    const list = parseM3u(
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-name="Named" tvg-logo="" group-title="News"',
        '',
        '#EXTVLCOPT:http-user-agent=x',
        'http://a/1.ts',
        '#EXTINF:-1',
        'http://a/2.ts',
        '#EXTINF:-1,Dangling',
      ].join('\r\n'),
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'Named', category: 'News', url: 'http://a/1.ts' });
    expect(list[0]!.logo).toBeUndefined();
    expect(list[1]!.name).toBe('http://a/2.ts');
    expect(list[0]!.key).toMatch(/^m[0-9a-z]+$/);
    expect(parseM3u('#EXTINF:-1,X\nhttp://a/1.ts')[0]!.key).toBe(list[0]!.key);
  });
});
