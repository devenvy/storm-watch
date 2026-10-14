import { TestBed } from '@angular/core/testing';

import { BoardsStore } from './boards.store';
import { type HomeLocation, SettingsStore } from './settings.store';
import { decodePayload, encodePayload, type SharePayload, ShareService } from './share';
import { STORAGE_BACKEND, type StorageBackend } from './storage/storage-backend';
import { LineupStore } from '../iptv/lineup.store';

import type { Lineup, Source } from '../iptv/models';
import type { MockInstance } from 'vitest';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  async get<T>() {
    return undefined as T | undefined;
  }
  async set() {
    /* no-op */
  }
  async remove() {
    /* no-op */
  }
}

const loc: HomeLocation = {
  lat: 31.22,
  lon: -85.39,
  label: 'Dothan, AL',
  city: 'Dothan',
  state: 'AL',
  office: 'TAE',
  radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/gridpoints/TAE/1,2/stations',
};

const source: Source = {
  kind: 'xtream',
  server: 'http://tv.example',
  username: 'u',
  password: 'p',
  format: 'ts',
};

const lineup: Lineup = {
  version: 1,
  channels: [{ key: 'x1', name: 'One', url: 'http://tv.example/live/u/p/1.ts' }],
  defaultKey: 'x1',
};

const untyped = (p: object) => p as SharePayload;

describe('share link encodings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to plain base64 JSON without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const p: SharePayload = { app: 'stormwatch', v: 1, autoTune: false };
    const encoded = await encodePayload(p);
    expect(encoded.startsWith('j')).toBe(true);
    expect(await decodePayload(encoded)).toEqual(p);
  });

  it('explains when compressed links cannot be opened', async () => {
    const encoded = await encodePayload({ app: 'stormwatch', v: 1 });
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(decodePayload(encoded)).rejects.toThrow(/cannot open compressed/);
  });
});

describe('ShareService', () => {
  let share: ShareService;
  let settings: SettingsStore;
  let boards: BoardsStore;
  let store: LineupStore;
  let loadCatalog: MockInstance<() => Promise<void>>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: new MemoryBackend() }],
    });
    share = TestBed.inject(ShareService);
    settings = TestBed.inject(SettingsStore);
    boards = TestBed.inject(BoardsStore);
    store = TestBed.inject(LineupStore);
    loadCatalog = vi.spyOn(store, 'loadCatalog').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves IPTV details out unless asked', async () => {
    settings.location.set(loc);
    store.source.set(source);
    store.lineup.set(lineup);
    const plain = (await decodePayload(await share.create({ includeIptv: false }))) as SharePayload;
    expect(plain).toMatchObject({ app: 'stormwatch', v: 1, location: loc, autoTune: true });
    expect(plain.boards).toHaveLength(3);
    expect(plain.source).toBeUndefined();
    expect(plain.lineup).toBeUndefined();

    const full = (await decodePayload(await share.create({ includeIptv: true }))) as SharePayload;
    expect(full.source).toEqual(source);
    expect(full.lineup).toEqual(lineup);
  });

  it('omits an unset location and source', async () => {
    const p = (await decodePayload(await share.create({ includeIptv: true }))) as SharePayload;
    expect(p.location).toBeUndefined();
    expect(p.source).toBeUndefined();
  });

  it('applies a link to a fresh device without asking', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const encoded = await encodePayload({
      app: 'stormwatch',
      v: 1,
      location: loc,
      boards: [
        {
          id: 'only',
          name: 'Only',
          rows: 4,
          widgets: [{ id: 'w', type: 'links', w: 3, h: 1 }],
        },
      ],
      autoTune: false,
      source,
      lineup,
    });
    await expect(share.apply(encoded)).resolves.toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(settings.location()).toEqual(loc);
    expect(boards.boards().map((b) => b.id)).toEqual(['only']);
    expect(settings.autoTune()).toBe(false);
    expect(store.source()).toEqual(source);
    expect(store.lineup()).toEqual(lineup);
    expect(loadCatalog).toHaveBeenCalledWith();
  });

  it('asks before overwriting a different setup and respects a refusal', async () => {
    settings.location.set({ ...loc, label: 'Mine' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const encoded = await encodePayload({ app: 'stormwatch', v: 1, location: loc });
    await expect(share.apply(encoded)).resolves.toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Apply this shared Storm Watch setup? It replaces your location on this device.',
    );
    expect(settings.location()?.label).toBe('Mine');
  });

  it('applies silently when the same link is opened again', async () => {
    store.source.set(source);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const encoded = await encodePayload({
      app: 'stormwatch',
      v: 1,
      source: { ...source, username: 'other' },
    });
    await expect(share.apply(encoded)).resolves.toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]![0]).toContain('IPTV login + channels');
    expect(store.source()).toMatchObject({ username: 'other' });
    // No lineup in the link: the existing one is kept.
    expect(store.lineup().channels).toEqual([]);

    await expect(share.apply(encoded)).resolves.toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('logs a failed catalog reload without failing the apply', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadCatalog.mockRejectedValue(new Error('offline'));
    const encoded = await encodePayload({ app: 'stormwatch', v: 1, source });
    await expect(share.apply(encoded)).resolves.toBe(true);
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith(
      'Storm Watch: could not reload the channel catalog',
      expect.any(Error),
    );
  });

  it('rejects payloads from other apps or versions', async () => {
    const other = await encodePayload(untyped({ app: 'x', v: 1 }));
    const v2 = await encodePayload(untyped({ app: 'stormwatch', v: 2 }));
    await expect(share.apply(other)).rejects.toThrow('Not a Storm Watch share link.');
    await expect(share.apply(v2)).rejects.toThrow('Not a Storm Watch share link.');
    // `j` + base64url("null")
    await expect(share.apply('jbnVsbA')).rejects.toThrow('Not a Storm Watch share link.');
  });
});
