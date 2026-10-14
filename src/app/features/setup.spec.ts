import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Setup } from './setup';
import { BoardsStore } from '../core/boards.store';
import { NwsService, type PointInfo } from '../core/nws.service';
import { type HomeLocation, SettingsStore } from '../core/settings.store';
import { ShareService } from '../core/share';
import { STORAGE_BACKEND, type StorageBackend } from '../core/storage/storage-backend';
import { LineupStore } from '../iptv/lineup.store';

import type { Channel, Source } from '../iptv/models';
import type { Mock, MockInstance } from 'vitest';

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const home: HomeLocation = {
  lat: 31.22,
  lon: -85.39,
  label: 'Dothan, AL',
  city: 'Dothan',
  state: 'AL',
  office: 'TAE',
  radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/x',
};

const xtream: Source = {
  kind: 'xtream',
  server: 'http://tv.example',
  username: 'u',
  password: 'p',
  format: 'ts',
};

const catalog: Channel[] = [
  { key: 'x1', name: 'US| WSFA 12 News Dothan', url: 'http://tv.example/1', category: 'Local' },
  { key: 'x2', name: 'Weather Channel', url: 'http://tv.example/2', category: 'News' },
  { key: 'x3', name: 'Cartoons', url: 'http://tv.example/3', category: 'Kids' },
];

describe('Setup', () => {
  let fixture: ComponentFixture<Setup>;
  let el: HTMLElement;
  let settings: SettingsStore;
  let lineup: LineupStore;
  let loadCatalog: MockInstance<LineupStore['loadCatalog']>;
  let point: Mock<NwsService['point']>;
  let fetchSpy: Mock<typeof fetch>;

  beforeEach(() => {
    point = vi.fn<NwsService['point']>();
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: NwsService, useValue: { point } },
      ],
    });
    settings = TestBed.inject(SettingsStore);
    lineup = TestBed.inject(LineupStore);
    loadCatalog = vi.spyOn(lineup, 'loadCatalog').mockResolvedValue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async () => {
    fixture = TestBed.createComponent(Setup);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  };
  const stable = async () => {
    await fixture.whenStable();
    await new Promise((r) => {
      setTimeout(r);
    });
    await fixture.whenStable();
  };
  const section = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
  const button = (scope: HTMLElement, text: string) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent.includes(text),
    )!;
  // Compression runs on real streams that whenStable does not track: wait for the link itself.
  const createLink = async () => {
    button(section('share'), 'Create link').click();
    await vi.waitFor(() => {
      expect(section('share').querySelector('textarea')).not.toBeNull();
    });
    await stable();
  };
  const type = (input: HTMLInputElement | HTMLSelectElement, value: string, event = 'input') => {
    input.value = value;
    input.dispatchEvent(new Event(event));
  };

  describe('location', () => {
    it('searches places and picks one', async () => {
      fetchSpy.mockResolvedValue(
        json({
          results: [
            {
              name: 'Dothan',
              admin1: 'Alabama',
              country_code: 'US',
              latitude: 31.2,
              longitude: -85.4,
            },
          ],
        }),
      );
      point.mockResolvedValue({
        city: 'Dothan',
        state: 'AL',
        office: 'TAE',
        radarStation: 'KEOX',
        stationsUrl: 'https://api.weather.gov/x',
      } satisfies PointInfo);
      await render();
      const q = section('location').querySelector('input')!;
      q.value = ' Dothan ';
      q.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      await stable();
      expect(fetchSpy.mock.calls[0]![0] as string).toContain('name=Dothan&count=8');
      const pick = el.querySelector<HTMLButtonElement>('button.pick')!;
      expect(pick.textContent).toContain('Dothan, Alabama (US)');
      pick.click();
      await stable();
      expect(point).toHaveBeenCalledWith(31.2, -85.4);
      expect(settings.location()).toMatchObject({ label: 'Dothan, AL', lat: 31.2, office: 'TAE' });
      expect(el.querySelector('button.pick')).toBeNull();
      expect(section('location').textContent).toContain('Monitoring Dothan, AL');
    });

    it('ignores blank searches and reports empty or failed ones', async () => {
      await render();
      const q = section('location').querySelector('input')!;
      button(section('location'), 'Search').click();
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockResolvedValueOnce(json({}));
      q.value = 'Nowhere';
      button(section('location'), 'Search').click();
      await stable();
      expect(section('location').querySelector('.err')?.textContent).toBe('No matches.');

      fetchSpy.mockRejectedValueOnce(new TypeError('offline'));
      button(section('location'), 'Search').click();
      await stable();
      expect(section('location').querySelector('.err')?.textContent).toBe(
        'Location search failed.',
      );
    });

    it('explains points NWS does not cover', async () => {
      point.mockRejectedValue(new Error('404'));
      await render();
      await (
        fixture.componentInstance as unknown as { pick: (a: number, b: number) => Promise<void> }
      ).pick(51.5, 0);
      await stable();
      expect(section('location').querySelector('.err')?.textContent).toContain('US locations only');
    });

    it('uses the device location when available', async () => {
      point.mockResolvedValue(home);
      const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>();
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      });
      try {
        await render();
        button(section('location'), 'Use my location').click();
        const [ok, fail] = getCurrentPosition.mock.calls[0]!;
        ok({ coords: { latitude: 30.5, longitude: -86.1 } } as GeolocationPosition);
        await stable();
        expect(point).toHaveBeenCalledWith(30.5, -86.1);
        fail?.({ message: 'denied' } as GeolocationPositionError);
        await stable();
        expect(section('location').querySelector('.err')?.textContent).toBe(
          'Location unavailable: denied',
        );
      } finally {
        Reflect.deleteProperty(navigator, 'geolocation');
      }
    });

    it('does nothing where geolocation is unsupported', async () => {
      await render();
      expect('geolocation' in navigator).toBe(false);
      button(section('location'), 'Use my location').click();
      await stable();
      expect(section('location').querySelector('.err')).toBeNull();
    });

    it('toggles auto-tune', async () => {
      await render();
      const box = section('location').querySelector<HTMLInputElement>('input[type=checkbox]')!;
      expect(box.checked).toBe(true);
      box.click();
      expect(settings.autoTune()).toBe(false);
    });
  });

  describe('IPTV source', () => {
    it('connects to an Xtream provider and prefers HLS when offered', async () => {
      fetchSpy.mockResolvedValue(
        json({
          user_info: {
            auth: 1,
            status: 'Active',
            max_connections: 2,
            active_cons: 0,
            allowed_output_formats: ['ts', 'm3u8'],
            exp_date: 1_900_000_000,
          },
        }),
      );
      await render();
      const [server, user, pass] =
        section('iptv').querySelectorAll<HTMLInputElement>('.form input');
      server!.value = 'http://tv.example';
      user!.value = 'u';
      pass!.value = 'p';
      button(section('iptv'), 'Connect').click();
      await stable();
      expect(lineup.source()).toEqual({ ...xtream, format: 'm3u8' });
      expect(loadCatalog).toHaveBeenCalledWith();
      expect(section('iptv').querySelector('.ok')?.textContent).toContain(
        'Connected · Active · 0/2',
      );
      expect(section('iptv').querySelector('.ok')?.textContent).toContain('expires');
    });

    it('shows login failures', async () => {
      fetchSpy.mockResolvedValue(json({ user_info: { auth: 0 } }));
      await render();
      section('iptv').querySelector<HTMLInputElement>('.form input')!.value = 'http://tv.example';
      button(section('iptv'), 'Connect').click();
      await stable();
      expect(section('iptv').querySelector('.err')?.textContent).toContain('Login rejected');
      expect(lineup.source()).toBeNull();
    });

    it('loads an M3U playlist', async () => {
      await render();
      const kind = section('iptv').querySelector('select')!;
      type(kind, 'm3u', 'change');
      await stable();
      const url = section('iptv').querySelector<HTMLInputElement>('.form input')!;
      url.value = 'http://tv.example/list.m3u';
      button(section('iptv'), 'Load').click();
      await stable();
      expect(lineup.source()).toEqual({ kind: 'm3u', url: 'http://tv.example/list.m3u' });
      expect(loadCatalog).toHaveBeenCalledWith();
      type(kind, 'xtream', 'change');
      await stable();
      expect(button(section('iptv'), 'Connect')).toBeDefined();
    });

    it('prefills saved sources and reloads their catalog', async () => {
      lineup.source.set({ kind: 'm3u', url: 'http://tv.example/saved.m3u' });
      await render();
      await stable();
      expect(section('iptv').querySelector<HTMLInputElement>('.form input')!.value).toBe(
        'http://tv.example/saved.m3u',
      );
      expect(loadCatalog).toHaveBeenCalledTimes(1);
    });

    it('logs a failed catalog reload for a saved source', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      loadCatalog.mockRejectedValue(new Error('offline'));
      lineup.source.set(xtream);
      await render();
      await stable();
      expect(section('iptv').querySelector<HTMLInputElement>('.form input')!.value).toBe(
        'http://tv.example',
      );
      expect(error).toHaveBeenCalledWith('Could not load the channel list', expect.any(Error));
    });

    it('shows catalog status', async () => {
      await render();
      lineup.catalogLoading.set(true);
      lineup.catalogError.set('Playlist failed: HTTP 500');
      await stable();
      expect(section('iptv').textContent).toContain('Loading channel list…');
      expect(section('iptv').querySelector('.err')?.textContent).toBe('Playlist failed: HTTP 500');
    });
  });

  describe('suggestions and search', () => {
    beforeEach(() => {
      settings.location.set(home);
      lineup.catalog.set(catalog);
    });

    it('suggests local channels and adds them to the lineup', async () => {
      await render();
      expect(el.textContent).toContain('3 channels available.');
      expect(el.textContent).toContain('Suggested for Dothan');
      const items = el.querySelectorAll<HTMLLabelElement>('.list label.item:not(.plain)');
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]!.textContent).toContain('WSFA');
      items[0]!.querySelector('input')!.click();
      expect(lineup.keys().has('x1')).toBe(true);
    });

    it('searches the catalog by name or category once two letters are typed', async () => {
      await render();
      const box = el.querySelector<HTMLInputElement>('input[placeholder^="Search by name"]')!;
      type(box, 'k');
      await stable();
      expect(el.querySelectorAll('label.item.plain')).toHaveLength(0);
      type(box, 'KIDS');
      await stable();
      const found = el.querySelectorAll<HTMLLabelElement>('label.item.plain');
      expect(found).toHaveLength(1);
      found[0]!.querySelector('input')!.click();
      expect(lineup.keys().has('x3')).toBe(true);
      type(box, 'weather');
      await stable();
      expect(el.querySelectorAll('label.item.plain')).toHaveLength(1);
    });

    it('says when nothing stands out', async () => {
      settings.location.set(null);
      lineup.catalog.set([catalog[2]!]);
      await render();
      expect(el.textContent).toContain('Suggested for you');
      expect(el.textContent).toContain('No strong matches.');
    });
  });

  describe('lineup', () => {
    beforeEach(() => {
      catalog.forEach((c) => {
        lineup.add(c);
      });
    });

    it('renames, reorders, sets the default and removes channels', async () => {
      await render();
      const rows = () => section('lineup').querySelectorAll<HTMLElement>('.lrow');
      expect(rows()).toHaveLength(3);
      const name = rows()[0]!.querySelector('input')!;
      type(name, 'WSFA', 'change');
      expect(lineup.channels()[0]!.name).toBe('WSFA');

      rows()[0]!.querySelector<HTMLButtonElement>('[aria-label="Move down"]')!.click();
      expect(lineup.channels().map((c) => c.key)).toEqual(['x2', 'x1', 'x3']);
      await stable();
      rows()[2]!.querySelector<HTMLButtonElement>('[aria-label="Move up"]')!.click();
      expect(lineup.channels().map((c) => c.key)).toEqual(['x2', 'x3', 'x1']);
      await stable();
      button(rows()[1]!, '★').click();
      expect(lineup.defaultChannel()?.key).toBe('x3');
      await stable();
      expect(rows()[1]!.querySelector('button.on')).not.toBeNull();
      rows()[1]!.querySelector<HTMLButtonElement>('[aria-label="Remove"]')!.click();
      expect(lineup.channels()).toHaveLength(2);
    });

    it('exports the lineup as a JSON download', async () => {
      const createObjectURL = vi.fn<(b: Blob) => string>(() => 'blob:lineup');
      const revokeObjectURL = vi.fn<(u: string) => void>();
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      await render();
      button(section('lineup'), 'Export').click();
      expect(click).toHaveBeenCalledWith();
      const blob = createObjectURL.mock.calls[0]![0];
      expect(blob.type).toBe('application/json');
      expect(JSON.parse(await blob.text())).toMatchObject({ app: 'stormwatch' });
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:lineup');
    });

    it('imports a lineup file and reports bad files', async () => {
      const exported = lineup.exportJson();
      ['x1', 'x2', 'x3'].forEach((k) => {
        lineup.remove(k);
      });
      await render();
      const input = section('lineup').querySelector<HTMLInputElement>('input[type=file]')!;
      const choose = async (files: File[]) => {
        Object.defineProperty(input, 'files', { configurable: true, value: files });
        input.dispatchEvent(new Event('change'));
        await stable();
      };
      await choose([]);
      expect(section('lineup').textContent).not.toContain('Imported');
      await choose([new File([exported], 'lineup.json')]);
      expect(section('lineup').textContent).toContain('Imported 3 channels.');
      await choose([new File(['{"app":"x"}'], 'bad.json')]);
      expect(section('lineup').textContent).toContain('Not a Storm Watch export.');
    });
  });

  describe('share link', () => {
    beforeEach(() => {
      settings.location.set(home);
    });

    it('creates a kiosk link for the chosen board and copies it', async () => {
      const writeText = vi.fn<(s: string) => Promise<void>>().mockResolvedValue();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      try {
        await render();
        const board = section('share').querySelector('select')!;
        type(board, 'radar', 'change');
        await stable();
        await createLink();
        const link = section('share').querySelector('textarea')!.value;
        expect(link).toMatch(/#\/d\/radar\?cfg=[zj][\w-]+&kiosk=1$/);
        expect(section('share').querySelector('.warn')).toBeNull();
        button(section('share'), 'Copy').click();
        await stable();
        expect(writeText).toHaveBeenCalledWith(link);
        expect(button(section('share'), 'Copied')).toBeDefined();

        // Changing an option invalidates the link.
        section('share').querySelectorAll<HTMLInputElement>('input[type=checkbox]')[0]!.click();
        await stable();
        expect(section('share').querySelector('textarea')).toBeNull();
        await createLink();
        expect(section('share').querySelector('textarea')!.value).not.toContain('kiosk');
      } finally {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    });

    it('warns when the link carries IPTV credentials', async () => {
      lineup.source.set(xtream);
      await render();
      const iptv = section('share').querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]!;
      expect(iptv.disabled).toBe(false);
      iptv.click();
      await stable();
      expect(section('share').querySelector('.warn')?.textContent).toContain(
        'will contain your IPTV username',
      );
      await createLink();
      expect(section('share').querySelector('.warn')?.textContent).toContain(
        'This link contains your IPTV username',
      );
    });

    it('reports failures to create or copy the link', async () => {
      const create = vi.spyOn(TestBed.inject(ShareService), 'create');
      create.mockRejectedValueOnce(new Error('too big'));
      await render();
      button(section('share'), 'Create link').click();
      await stable();
      expect(section('share').querySelector('.err')?.textContent).toBe('too big');

      button(section('share'), 'Create link').click();
      await stable();
      // No clipboard in jsdom: copying fails.
      button(section('share'), 'Copy').click();
      await stable();
      expect(section('share').querySelector('.err')?.textContent).toContain('Copy failed');
    });

    it('drops a link whose options changed while it was being built', async () => {
      let finish!: (s: string) => void;
      vi.spyOn(TestBed.inject(ShareService), 'create').mockImplementationOnce(
        async () =>
          new Promise<string>((r) => {
            finish = r;
          }),
      );
      await render();
      button(section('share'), 'Create link').click();
      section('share').querySelectorAll<HTMLInputElement>('input[type=checkbox]')[0]!.click();
      await stable();
      finish('jabc');
      await stable();
      expect(section('share').querySelector('textarea')).toBeNull();
      expect(TestBed.inject(BoardsStore).first().id).toBe('storm');
    });
  });
});
