import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RadarWidget } from './radar-widget';
import { AlertsStore } from '../../core/alerts.store';
import { type RadarSourceId, RadarSources } from '../../core/radar-sources';
import { STORAGE_BACKEND, type StorageBackend } from '../../core/storage/storage-backend';

import type { HomeLocation } from '../../core/settings.store';

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

const home: HomeLocation = {
  lat: 31,
  lon: -85,
  label: 'Home',
  city: '',
  state: '',
  office: 'TAE',
  radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/x',
};

describe('RadarWidget', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', vi.fn(observeNothing));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: RadarSources, useValue: { load: async () => ({ frames: [], startIndex: 0 }) } },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const render = async (source: RadarSourceId) => {
    const fixture = TestBed.createComponent(RadarWidget);
    fixture.componentRef.setInput('location', home);
    fixture.componentRef.setInput('source', source);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('shows the map for tile sources and lets the user switch source', async () => {
    const { fixture, el } = await render('blend');
    expect(el.querySelector('sw-radar-map')).not.toBeNull();
    const changes: RadarSourceId[] = [];
    fixture.componentInstance.source.subscribe((s) => {
      changes.push(s);
    });
    const select = el.querySelector('select')!;
    expect(select.options).toHaveLength(7);
    select.value = 'site-gif';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(changes).toEqual(['site-gif']);
    expect(el.querySelector('sw-radar-map')).toBeNull();
    expect(el.querySelector('img.site')).not.toBeNull();
  });

  it('busts the loop image cache whenever alerts refresh', async () => {
    const { fixture, el } = await render('site-gif');
    const img = () => el.querySelector<HTMLImageElement>('img.site')!;
    expect(img().src).toBe('https://radar.weather.gov/ridge/standard/KEOX_loop.gif?_=0');
    TestBed.inject(AlertsStore).feeds.update((f) => ({
      ...f,
      alerts: { okAt: new Date(1_000), error: null },
    }));
    await fixture.whenStable();
    expect(img().src).toBe('https://radar.weather.gov/ridge/standard/KEOX_loop.gif?_=1000');
  });
});
