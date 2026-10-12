import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ConditionsWidget } from './conditions-widget';
import { AlertsStore } from '../../core/alerts.store';
import { SettingsStore } from '../../core/settings.store';
import { STORAGE_BACKEND, type StorageBackend } from '../../core/storage/storage-backend';

import type { PwsStation } from '../../core/ambient.service';
import type { Observation } from '../../core/nws.service';

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

const station = (id: string, extra: Partial<PwsStation> = {}): PwsStation => ({
  id,
  name: `PWS ${id}`,
  place: 'Dothan',
  distanceMi: 1.25,
  at: Date.now(),
  tempF: 71,
  feelsLikeF: 73,
  humidity: 80,
  windMph: 5,
  gustMph: 12,
  maxGustMph: 20,
  windDir: 90,
  rainRateIn: 0.1,
  rainTodayIn: 1.5,
  rainEventIn: 2.25,
  pressureInHg: 29.9,
  ...extra,
});

const observation = (extra: Partial<Observation> = {}): Observation => ({
  station: 'KDHN',
  stationName: 'Dothan Airport',
  distanceMi: 4.4,
  timestamp: '2026-10-10T12:00:00Z',
  text: 'Light Rain',
  tempF: 70,
  feelsLikeF: 70,
  humidity: 90,
  windMph: 8,
  gustMph: 18,
  windDir: 180,
  pressureInHg: 29.85,
  ...extra,
});

describe('ConditionsWidget', () => {
  let store: AlertsStore;
  let settings: SettingsStore;

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
    settings = TestBed.inject(SettingsStore);
  });

  const render = async () => {
    const fixture = TestBed.createComponent(ConditionsWidget);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  const setFeed = (feed: 'observation' | 'pws', error: string | null) => {
    store.feeds.update((f) => ({ ...f, [feed]: { okAt: null, error } }));
  };

  it('shows loading, then an error, when nothing has reported', async () => {
    expect((await render()).el.textContent).toContain('Loading conditions…');
    setFeed('observation', 'down');
    setFeed('pws', 'down');
    const { el } = await render();
    expect(el.textContent).toContain('Conditions unavailable right now.');
    expect(el.textContent).toContain('Home station network unavailable.');
  });

  it('shows the NWS observation when there is no home station', async () => {
    store.observation.set(observation());
    const { el } = await render();
    expect(el.querySelector('h2')?.textContent).toContain('Dothan Airport');
    expect(el.textContent).toContain('NWS station KDHN');
    expect(el.textContent).toContain('4 mi away');
    expect(el.textContent).toContain('wind S');
    expect(el.textContent).toContain('Light Rain');
  });

  it('handles an observation with unknown values', async () => {
    store.observation.set(
      observation({ distanceMi: null, tempF: null, gustMph: null, text: '', windDir: null }),
    );
    const { el } = await render();
    expect(el.textContent).not.toContain('mi away');
    expect(el.textContent).toContain('–°');
  });

  it('shows the home station with the NWS line beneath it', async () => {
    store.stations.set([station('a')]);
    store.observation.set(observation());
    setFeed('pws', 'Ambient 500');
    const { el } = await render();
    expect(el.querySelector('h2')?.textContent).toContain('PWS a');
    expect(el.textContent).toContain('Home station in Dothan, 1.3 mi away');
    expect(el.textContent).toContain('storm total');
    expect(el.textContent).toContain('showing the last readings');
    expect(el.querySelector('.nws')?.textContent).toContain('G 18');
  });

  it('handles a home station with missing readings and an NWS line without extras', async () => {
    store.stations.set([
      station('a', { place: '', rainEventIn: null, tempF: null, windDir: null }),
    ]);
    store.observation.set(observation({ distanceMi: null, gustMph: null }));
    const { el } = await render();
    expect(el.textContent).toContain('Home station, 1.3 mi away');
    expect(el.textContent).not.toContain('storm total');
    expect(el.querySelector('.nws')?.textContent).not.toContain('G ');
  });

  it('lets the user pin a nearby station and go back to the nearest', async () => {
    store.stations.set([station('a'), station('b', { distanceMi: 3 })]);
    const { fixture, el } = await render();
    expect(el.textContent).toContain('Nearby home stations (2 reporting)');
    expect(el.querySelector('button.link')).toBeNull();
    const buttons = el.querySelectorAll<HTMLButtonElement>('.nearby li button');
    buttons[1]!.click();
    expect(settings.pws()).toBe('b');
    await fixture.whenStable();
    expect(el.textContent).toContain('· pinned');
    expect(el.querySelector('li.current')?.textContent).toContain('PWS b');
    el.querySelector<HTMLButtonElement>('button.link')!.click();
    expect(settings.pws()).toBeNull();
  });
});
