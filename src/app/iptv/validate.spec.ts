import { sanitizeLineup, sanitizeSource } from './validate';

describe('sanitizeSource', () => {
  const xt = { kind: 'xtream', server: 'https://tv.example', username: 'u', password: 'p' };

  it('keeps valid sources and normalizes the stream format', () => {
    expect(sanitizeSource({ ...xt, format: 'm3u8', extra: 1 })).toEqual({ ...xt, format: 'm3u8' });
    expect(sanitizeSource({ kind: 'm3u', url: 'https://tv.example/list.m3u', x: 1 })).toEqual({
      kind: 'm3u',
      url: 'https://tv.example/list.m3u',
    });
  });

  it('rejects incomplete or unknown sources', () => {
    expect(sanitizeSource({ ...xt, server: 'ftp://tv.example' })).toBeNull();
    expect(sanitizeSource({ ...xt, username: 5 })).toBeNull();
    expect(sanitizeSource({ ...xt, password: 'p'.repeat(201) })).toBeNull();
    expect(sanitizeSource({ kind: 'other' })).toBeNull();
    expect(sanitizeSource(null)).toBeNull();
  });
});

describe('sanitizeLineup', () => {
  it('keeps optional channel fields only when valid', () => {
    const l = sanitizeLineup({
      channels: [
        {
          key: 'a',
          name: 'A',
          url: 'https://tv.example/a',
          logo: 'https://tv.example/a.png',
          category: 'News',
          epgId: 'a.us',
          streamId: 7,
          junk: true,
        },
        { key: 'b', name: 'B', url: 'https://tv.example/b', category: 5, streamId: -1 },
        null,
        { key: 'c', url: 'https://tv.example/c' },
      ],
      defaultKey: 'a',
    });
    expect(l).toEqual({
      version: 1,
      channels: [
        {
          key: 'a',
          name: 'A',
          url: 'https://tv.example/a',
          logo: 'https://tv.example/a.png',
          category: 'News',
          epgId: 'a.us',
          streamId: 7,
        },
        { key: 'b', name: 'B', url: 'https://tv.example/b' },
      ],
      defaultKey: 'a',
    });
  });

  it('caps the channel count and rejects non-lineups', () => {
    const channels = Array.from({ length: 250 }, (_, i) => ({
      key: `k${i}`,
      name: `C${i}`,
      url: `https://tv.example/${i}`,
    }));
    expect(sanitizeLineup({ channels })?.channels).toHaveLength(200);
    expect(sanitizeLineup({ channels: 'x' })).toBeNull();
    expect(sanitizeLineup(null)).toBeNull();
  });
});
