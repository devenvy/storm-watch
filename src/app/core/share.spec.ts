import { sanitizeBoards } from './boards.store';
import { sanitizeLocation } from './settings.store';
import { decodePayload, encodePayload, type SharePayload } from './share';
import { sanitizeLineup, sanitizeSource } from '../iptv/validate';

const loc = {
  lat: 31.22, lon: -85.39, label: 'Dothan, AL', city: 'Dothan', state: 'AL',
  office: 'TAE', radarStation: 'KEOX', stationsUrl: 'https://api.weather.gov/gridpoints/TAE/1,2/stations',
};

describe('share links', () => {
  it('round-trips a payload', async () => {
    const p: SharePayload = { app: 'stormwatch', v: 1, location: loc };
    const encoded = await encodePayload(p);
    expect(encoded).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    expect(await decodePayload(encoded)).toEqual(p);
  });

  it('rejects unknown formats and oversize input', async () => {
    await expect(decodePayload('xabc')).rejects.toThrow();
    await expect(decodePayload(`j${  'a'.repeat(70_000)}`)).rejects.toThrow(/too large/);
  });

  it('stops decompressing a zip bomb at the size limit', async () => {
    const huge = { app: 'stormwatch', v: 1, pad: 'x'.repeat(4_000_000) } as unknown as SharePayload;
    const encoded = await encodePayload(huge);
    expect(encoded.length).toBeLessThan(64_000);
    await expect(decodePayload(encoded)).rejects.toThrow(/too large/);
  });

  it('validates locations', () => {
    expect(sanitizeLocation(loc)).toEqual(loc);
    expect(sanitizeLocation({ ...loc, lat: 200 })).toBeNull();
    expect(sanitizeLocation({ ...loc, stationsUrl: 'https://evil.example/x' })).toBeNull();
    expect(sanitizeLocation({ ...loc, radarStation: '<img>' })).toBeNull();
  });

  it('only accepts http(s) URLs for IPTV sources and channels', () => {
    expect(sanitizeSource({ kind: 'm3u', url: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeSource({ kind: 'xtream', server: 'http://tv.example:8080', username: 'u', password: 'p', format: 'x' }))
      .toEqual({ kind: 'xtream', server: 'http://tv.example:8080', username: 'u', password: 'p', format: 'ts' });
    const l = sanitizeLineup({
      channels: [
        { key: 'a', name: 'A', url: 'https://x.example/a.m3u8', logo: 'data:text/html,hi' },
        { key: 'b', name: 'B', url: 'file:///etc/passwd' },
      ],
      defaultKey: 'b',
    });
    expect(l?.channels).toEqual([{ key: 'a', name: 'A', url: 'https://x.example/a.m3u8' }]);
    expect(l?.defaultKey).toBeNull();
  });

  it('cleans board definitions', () => {
    const boards = sanitizeBoards([
      { id: 'My Board!', name: 'Mine', rows: 99, widgets: [{ type: 'radar', w: 40, h: 0, source: 'nope' }, { type: 'bogus' }] },
    ]);
    expect(boards).toHaveLength(1);
    expect(boards![0].id).toBe('my-board');
    expect(boards![0].rows).toBe(12);
    expect(boards![0].widgets).toHaveLength(1);
    expect(boards![0].widgets[0]).toMatchObject({ type: 'radar', w: 12, h: 2 });
    expect(boards![0].widgets[0].source).toBeUndefined();
    expect(sanitizeBoards('nope')).toBeNull();
  });
});
