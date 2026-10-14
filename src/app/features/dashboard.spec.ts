import { CdkDropList } from '@angular/cdk/drag-drop';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';

import { Dashboard } from './dashboard';
import { RadarWidget } from './widgets/radar-widget';
import { AmbientService } from '../core/ambient.service';
import { type Board, BoardsStore } from '../core/boards.store';
import { NhcService } from '../core/nhc.service';
import { NwsService } from '../core/nws.service';
import { RadarSources } from '../core/radar-sources';
import { type HomeLocation, SettingsStore } from '../core/settings.store';
import { STORAGE_BACKEND, type StorageBackend } from '../core/storage/storage-backend';
import { LineupStore } from '../iptv/lineup.store';

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

function observeNothing(): ResizeObserver {
  const noop = () => undefined;
  return { observe: noop, unobserve: noop, disconnect: noop };
}

const never = async () =>
  new Promise<never>(() => {
    /* never settles */
  });

const home: HomeLocation = {
  lat: 31,
  lon: -85,
  label: 'Home',
  city: 'Dothan',
  state: 'AL',
  office: 'TAE',
  radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/x',
};

const boards: Board[] = [
  {
    id: 'all',
    name: 'All',
    rows: 6,
    widgets: [
      { id: 'r', type: 'radar', w: 6, h: 6, source: 'mosaic' },
      { id: 'p', type: 'player', w: 4, h: 1 },
      { id: 'c', type: 'channels', w: 4, h: 2 },
      { id: 'a', type: 'alerts', w: 3, h: 9 },
      { id: 'n', type: 'conditions', w: 3, h: 1 },
      { id: 't', type: 'tropical', w: 3, h: 1 },
      { id: 'l', type: 'links', w: 3, h: 1 },
    ],
  },
  { id: 'empty', name: 'Empty', rows: 4, widgets: [] },
];

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let el: HTMLElement;
  let store: BoardsStore;
  let navigate: MockInstance<Router['navigate']>;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', vi.fn(observeNothing));
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: RadarSources, useValue: { load: never } },
        {
          provide: NwsService,
          useValue: { alertsAt: never, warningShapes: never, latestObservation: never },
        },
        { provide: NhcService, useValue: { activeStorms: never } },
        { provide: AmbientService, useValue: { nearby: never } },
      ],
    });
    store = TestBed.inject(BoardsStore);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    // Destroy the player while HTMLMediaElement.load is still stubbed (jsdom lacks it).
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(Dashboard);
    for (const [k, v] of Object.entries(inputs)) {
      fixture.componentRef.setInput(k, v);
    }
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  };
  const stable = async (): Promise<void> => {
    await fixture.whenStable();
  };
  const button = (text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent.includes(text),
    )!;
  const labelled = (label: string) => el.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`);
  const current = () => store.byId('all');
  const startEditing = async () => {
    button('Edit').click();
    await stable();
  };

  describe('with a home location', () => {
    beforeEach(() => {
      TestBed.inject(SettingsStore).location.set(home);
      store.boards.set(structuredClone(boards));
    });

    it('renders every widget type with mobile heights', async () => {
      await render({ board: 'all' });
      for (const tag of [
        'sw-radar-widget',
        'sw-player-widget',
        'sw-channels-widget',
        'sw-alerts-widget',
        'sw-conditions-widget',
        'sw-tropical-widget',
        'sw-links-widget',
      ]) {
        expect(el.querySelector(tag), tag).not.toBeNull();
      }
      const cells = el.querySelectorAll<HTMLElement>('.cell');
      // Media widgets stay 3-5 rows tall when stacked; others 1-4.
      expect(cells[0]!.style.getPropertyValue('--mh')).toBe('5');
      expect(cells[1]!.style.getPropertyValue('--mh')).toBe('3');
      expect(cells[3]!.style.getPropertyValue('--mh')).toBe('4');
      expect(el.querySelector('.tab.on')?.textContent).toBe('All');
    });

    it('shows an empty board hint and falls back to the first board', async () => {
      await render({ board: 'empty' });
      expect(el.textContent).toContain('This dashboard is empty.');
      fixture.componentRef.setInput('board', 'missing');
      await stable();
      expect(el.querySelector('.tab.on')?.textContent).toBe('All');
    });

    it('hides the editing chrome in kiosk mode', async () => {
      await render({ board: 'all', kiosk: '' });
      expect(el.querySelector('nav.bar')).toBeNull();
      for (const off of ['false', '0', undefined, null]) {
        fixture.componentRef.setInput('kiosk', off);
        await stable();
        expect(el.querySelector('nav.bar'), String(off)).not.toBeNull();
      }
    });

    it('edits the board name, rows and widgets', async () => {
      await render({ board: 'all' });
      await startEditing();
      expect(el.querySelector('.editbar')).not.toBeNull();
      expect(el.querySelectorAll('.overlay')).toHaveLength(7);

      const name = el.querySelector<HTMLInputElement>('.editbar input')!;
      name.value = '  Renamed  ';
      name.dispatchEvent(new Event('change'));
      expect(current().name).toBe('Renamed');

      const rows = el.querySelectorAll<HTMLSelectElement>('.editbar select')[0]!;
      rows.value = '9';
      rows.dispatchEvent(new Event('change'));
      expect(current().rows).toBe(9);

      const add = labelled('Widget type')[0] as HTMLSelectElement;
      add.value = 'tropical';
      button('Add widget').click();
      expect(current().widgets.at(-1)?.type).toBe('tropical');
      await stable();

      (labelled('Wider')[1] as HTMLButtonElement).click();
      (labelled('Taller')[1] as HTMLButtonElement).click();
      (labelled('Narrower')[0] as HTMLButtonElement).click();
      (labelled('Shorter')[0] as HTMLButtonElement).click();
      expect(current().widgets[1]).toMatchObject({ w: 5, h: 2 });
      expect(current().widgets[0]).toMatchObject({ w: 5, h: 5 });

      (labelled('Remove widget')[2] as HTMLButtonElement).click();
      expect(current().widgets.map((w) => w.id)).not.toContain('c');

      button('Done').click();
      await stable();
      expect(el.querySelector('.editbar')).toBeNull();
    });

    it('pins a channel to a player widget', async () => {
      const lineup = TestBed.inject(LineupStore);
      lineup.add({ key: 'x1', name: 'One', url: 'http://tv.example/1.m3u8' });
      await render({ board: 'all' });
      await startEditing();
      const pin = labelled('Pinned channel')[0] as HTMLSelectElement;
      expect(pin.options).toHaveLength(2);
      pin.value = 'x1';
      pin.dispatchEvent(new Event('change'));
      expect(current().widgets[1]!.channel).toBe('x1');
      await stable();
      pin.value = '';
      pin.dispatchEvent(new Event('change'));
      expect(current().widgets[1]!.channel).toBeUndefined();
    });

    it('reorders widgets on drop and stores the radar source', async () => {
      await render({ board: 'all' });
      fixture.debugElement
        .query(By.directive(CdkDropList))
        .triggerEventHandler('cdkDropListDropped', { previousIndex: 0, currentIndex: 2 });
      expect(
        current()
          .widgets.map((w) => w.id)
          .slice(0, 3),
      ).toEqual(['p', 'c', 'r']);
      await stable();
      fixture.debugElement
        .query(By.directive(RadarWidget))
        .triggerEventHandler('sourceChange', 'hrrr');
      expect(current().widgets.find((w) => w.id === 'r')?.source).toBe('hrrr');
    });

    it('creates, duplicates and moves boards', async () => {
      await render({ board: 'all' });
      await startEditing();
      button('New').click();
      expect(navigate).toHaveBeenLastCalledWith(['/d', 'board-3']);
      button('Duplicate').click();
      expect(navigate).toHaveBeenLastCalledWith(['/d', 'all-copy']);
      expect(store.byId('all-copy').widgets).toHaveLength(7);
      (labelled('Move tab right')[0] as HTMLButtonElement).click();
      expect(store.boards()[1]!.id).toBe('all');
      (labelled('Move tab left')[0] as HTMLButtonElement).click();
      expect(store.boards()[0]!.id).toBe('all');
    });

    it('deletes a board only after confirmation', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await render({ board: 'all' });
      await startEditing();
      button('Delete board').click();
      expect(confirmSpy).toHaveBeenCalledWith('Delete the "All" dashboard?');
      expect(store.boards()).toHaveLength(2);
      confirmSpy.mockReturnValue(true);
      button('Delete board').click();
      expect(store.boards().map((b) => b.id)).toEqual(['empty']);
      expect(navigate).toHaveBeenLastCalledWith(['/d', 'empty']);
    });

    it('resets all boards only after confirmation and logs navigation errors', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await render({ board: 'all' });
      await startEditing();
      button('Reset all').click();
      expect(store.boards()).toHaveLength(2);
      confirmSpy.mockReturnValue(true);
      navigate.mockRejectedValue(new Error('nav'));
      button('Reset all').click();
      expect(store.boards().map((b) => b.id)).toEqual(['storm', 'radar', 'no-tv']);
      expect(navigate).toHaveBeenLastCalledWith(['/']);
      await stable();
      expect(error).toHaveBeenCalledWith('Navigation failed', expect.any(Error));
    });
  });

  it('welcomes users without a home location', async () => {
    await render();
    expect(el.textContent).toContain('Welcome to Storm Watch');
  });
});
