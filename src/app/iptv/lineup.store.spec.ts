import { TestBed } from '@angular/core/testing';

import { LineupStore } from './lineup.store';
import { parseM3u } from './sources';
import { Persist } from '../core/storage/persist';
import { STORAGE_BACKEND, type StorageBackend } from '../core/storage/storage-backend';

import type { Channel, Source } from './models';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const ch = (key: string, url = `http://tv.example/${key}`, logo?: string): Channel => ({
  key,
  name: key.toUpperCase(),
  url,
  ...(logo ? { logo } : {}),
});

const m3u: Source = { kind: 'm3u', url: 'http://tv.example/list.m3u' };
const xtream: Source = {
  kind: 'xtream',
  server: 'http://tv.example',
  username: 'u',
  password: 'p',
  format: 'ts',
};

describe('LineupStore', () => {
  let store: LineupStore;
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: backend }],
    });
    store = TestBed.inject(LineupStore);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const keys = () => store.channels().map((c) => c.key);

  it('adds, toggles and removes channels without duplicates', () => {
    store.add(ch('a'));
    store.add(ch('a'));
    store.toggle(ch('b'));
    expect(keys()).toEqual(['a', 'b']);
    store.setDefault('b');
    expect(store.defaultChannel()?.key).toBe('b');
    store.toggle(ch('b'));
    expect(keys()).toEqual(['a']);
    expect(store.lineup().defaultKey).toBeNull();
    store.setDefault('a');
    store.remove('zzz');
    expect(store.lineup().defaultKey).toBe('a');
  });

  it('uses the first channel when no default is set', () => {
    expect(store.defaultChannel()).toBeNull();
    store.add(ch('a'));
    store.add(ch('b'));
    expect(store.defaultChannel()?.key).toBe('a');
  });

  it('moves channels within bounds and renames them', () => {
    ['a', 'b', 'c'].forEach((k) => {
      store.add(ch(k));
    });
    store.move('c', -1);
    expect(keys()).toEqual(['a', 'c', 'b']);
    const before = store.lineup();
    store.move('a', -1);
    store.move('b', 1);
    store.move('missing', 1);
    expect(store.lineup()).toBe(before);
    store.rename('a', 'Alpha');
    expect(store.channels()[0]!.name).toBe('Alpha');
    expect(store.channels()[1]!.name).toBe('C');
  });

  it('finds neighbors with wrap-around', () => {
    expect(store.neighbor('a', 1)).toBeNull();
    ['a', 'b', 'c'].forEach((k) => {
      store.add(ch(k));
    });
    expect(store.neighbor('a', -1)?.key).toBe('c');
    expect(store.neighbor('c', 1)?.key).toBe('a');
    expect(store.neighbor('b', 1)?.key).toBe('c');
    expect(store.neighbor('unknown', 1)?.key).toBe('b');
  });

  it('looks up channels in the lineup first, then the catalog', () => {
    store.add(ch('a', 'http://tv.example/mine'));
    store.catalog.set([ch('a', 'http://tv.example/catalog'), ch('z')]);
    expect(store.byKey('a')?.url).toBe('http://tv.example/mine');
    expect(store.byKey('z')?.key).toBe('z');
    expect(store.byKey('nope')).toBeUndefined();
  });

  it('exports and re-imports the source and lineup', () => {
    store.source.set(m3u);
    store.add(ch('a'));
    store.setDefault('a');
    const text = store.exportJson();
    expect(JSON.parse(text)).toMatchObject({ app: 'stormwatch', source: m3u });

    store.source.set(null);
    store.remove('a');
    store.importJson(text);
    expect(store.source()).toEqual(m3u);
    expect(keys()).toEqual(['a']);
    expect(store.lineup().defaultKey).toBe('a');
  });

  it('rejects files that are not Storm Watch exports', () => {
    expect(() => {
      store.importJson('null');
    }).toThrow('Not a Storm Watch export.');
    expect(() => {
      store.importJson('{"app":"other","lineup":{"channels":[]}}');
    }).toThrow('Not a Storm Watch export.');
    expect(() => {
      store.importJson('{"app":"stormwatch"}');
    }).toThrow('Not a Storm Watch export.');
    expect(() => {
      store.importJson('{nope');
    }).toThrow(SyntaxError);
  });

  describe('loadCatalog', () => {
    it('does nothing without a source', async () => {
      const spy = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', spy);
      await store.loadCatalog();
      expect(spy).not.toHaveBeenCalled();
    });

    it('loads an M3U catalog and refreshes saved channels on the same server', async () => {
      const playlist =
        '#EXTM3U\n#EXTINF:-1 tvg-logo="http://tv.example/logo.png",X\nhttp://tv.example/new\n';
      const [fresh] = parseM3u(playlist);
      store.add({
        key: fresh!.key,
        name: 'Mine',
        url: 'http://tv.example/old',
        logo: 'http://tv.example/logo-old.png',
      });
      store.add(ch('not-in-catalog'));
      store.source.set(m3u);
      TestBed.tick();
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(playlist)));

      const loading = store.loadCatalog();
      expect(store.catalogLoading()).toBe(true);
      await loading;
      expect(store.catalogLoading()).toBe(false);
      expect(store.catalogError()).toBeNull();
      expect(store.catalog()).toHaveLength(1);
      expect(store.channels()[0]).toEqual({
        key: fresh!.key,
        name: 'Mine',
        url: 'http://tv.example/new',
        logo: 'http://tv.example/logo.png',
      });
      expect(store.channels()[1]).toEqual(ch('not-in-catalog'));
    });

    it('keeps saved channels whose catalog entry is unchanged or on another server', async () => {
      store.source.set(xtream);
      TestBed.tick();
      store.add(ch('x1', 'http://tv.example/live/u/p/1.ts'));
      store.add(ch('x2', 'http://moved.example/live/u/p/2.ts'));
      store.add(ch('x3', 'not a url'));
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (input) =>
          urlOf(input).includes('categories')
            ? json([])
            : json([{ stream_id: 1 }, { stream_id: 2 }, { stream_id: 3 }]),
        ),
      );
      const before = store.lineup();
      await store.loadCatalog();
      expect(store.catalog().map((c) => c.key)).toEqual(['x1', 'x2', 'x3']);
      expect(store.lineup()).toBe(before);
    });

    it('records load errors', async () => {
      store.source.set(m3u);
      TestBed.tick();
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })),
      );
      await store.loadCatalog();
      expect(store.catalogError()).toBe('Playlist failed: HTTP 500');
      expect(store.catalogLoading()).toBe(false);
    });

    it('drops a catalog whose source changed while loading', async () => {
      store.source.set(m3u);
      TestBed.tick();
      let answer!: (r: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(
          async () =>
            new Promise<Response>((r) => {
              answer = r;
            }),
        ),
      );
      const loading = store.loadCatalog();
      store.source.set({ kind: 'm3u', url: 'http://tv.example/other.m3u' });
      TestBed.tick();
      expect(store.catalogLoading()).toBe(false);
      answer(new Response('#EXTINF:-1,A\nhttp://tv.example/a\n'));
      await loading;
      expect(store.catalog()).toEqual([]);
      expect(store.catalogLoading()).toBe(false);
    });

    it('ignores the error of a superseded load', async () => {
      store.source.set(m3u);
      TestBed.tick();
      let fail!: (e: Error) => void;
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockImplementationOnce(
            async () =>
              new Promise<Response>((_, reject) => {
                fail = reject;
              }),
          )
          .mockResolvedValue(new Response('#EXTINF:-1,A\nhttp://tv.example/a\n')),
      );
      const first = store.loadCatalog();
      await store.loadCatalog();
      fail(new Error('late'));
      await first;
      expect(store.catalogError()).toBeNull();
      expect(store.catalog()).toHaveLength(1);
    });
  });

  it('persists the lineup after hydration', async () => {
    await TestBed.inject(Persist).ready();
    store.add(ch('a'));
    TestBed.tick();
    await Promise.resolve();
    expect(backend.data.get('sw.lineup')).toMatchObject({ channels: [{ key: 'a' }] });
  });
});
