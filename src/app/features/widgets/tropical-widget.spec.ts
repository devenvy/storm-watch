import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TropicalWidget } from './tropical-widget';
import { AlertsStore } from '../../core/alerts.store';
import { STORAGE_BACKEND, type StorageBackend } from '../../core/storage/storage-backend';

import type { Storm } from '../../core/nhc.service';

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

const storm = (id: string, extra: Partial<Storm> = {}): Storm => ({
  id,
  name: `Storm ${id}`,
  classification: 'Hurricane',
  intensityKt: 100,
  pressureMb: 960,
  lat: 25,
  lon: -80,
  movementDir: 315,
  movementMph: 12,
  advisory: 'Advisory 12',
  coneImage: `https://www.nhc.noaa.gov/${id}.png`,
  advisoryUrl: `https://www.nhc.noaa.gov/${id}.shtml`,
  ...extra,
});

describe('TropicalWidget', () => {
  let store: AlertsStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: STORAGE_BACKEND, useValue: new MemoryBackend() }],
    });
    store = TestBed.inject(AlertsStore);
    // Let the store's location effect run (and reset its signals) before the tests set them.
    await new Promise((r) => {
      setTimeout(r);
    });
    TestBed.tick();
  });

  const render = async () => {
    const fixture = TestBed.createComponent(TropicalWidget);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  const setFeed = (okAt: Date | null, error: string | null) => {
    store.feeds.update((f) => ({ ...f, storms: { okAt, error } }));
  };

  it('shows a checking state, then an empty outlook', async () => {
    expect((await render()).textContent).toContain('Checking NHC…');
    setFeed(new Date(), null);
    expect((await render()).textContent).toContain('No active tropical cyclones.');
  });

  it('says when tropical data never loaded', async () => {
    setFeed(null, 'NHC 503');
    expect((await render()).textContent).toContain('Tropical data unavailable right now.');
  });

  it('lists storms with intensity, pressure and motion', async () => {
    store.storms.set([
      storm('a'),
      storm('b', { pressureMb: null, movementMph: null, movementDir: null }),
    ]);
    setFeed(new Date(2026, 9, 10, 9, 5), 'NHC 503');
    const el = await render();
    const links = el.querySelectorAll<HTMLAnchorElement>('a.storm');
    expect(links).toHaveLength(2);
    expect(links[0]!.href).toBe('https://www.nhc.noaa.gov/a.shtml');
    expect(links[0]!.textContent).toContain('Hurricane · 115 mph');
    expect(links[0]!.textContent).toContain('· 960 mb');
    expect(links[0]!.textContent).toContain('moving NW 12 mph');
    expect(links[1]!.textContent).not.toContain('mb');
    expect(links[1]!.textContent).not.toContain('moving');
    expect(el.textContent).toContain('Update failed; showing data from 9:05');
  });
});
