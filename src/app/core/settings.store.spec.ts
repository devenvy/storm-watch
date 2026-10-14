import { TestBed } from '@angular/core/testing';

import { sanitizeLocation, SettingsStore } from './settings.store';
import { Persist } from './storage/persist';
import { STORAGE_BACKEND, type StorageBackend } from './storage/storage-backend';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  constructor(readonly data: Map<string, unknown>) {}
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

const loc = {
  lat: 31.2234,
  lon: -85.3901,
  office: 'TAE',
  radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/gridpoints/TAE/1,2/stations',
};

describe('sanitizeLocation', () => {
  it('fills in a coordinate label and blank city/state', () => {
    expect(sanitizeLocation({ ...loc, label: 5, city: null, state: 'x'.repeat(41) })).toEqual({
      ...loc,
      label: '31.22, -85.39',
      city: '',
      state: '',
    });
  });

  it('rejects malformed office codes and missing data', () => {
    expect(sanitizeLocation({ ...loc, office: 'tae' })).toBeNull();
    expect(sanitizeLocation({ ...loc, stationsUrl: 42 })).toBeNull();
    expect(sanitizeLocation(null)).toBeNull();
  });
});

describe('SettingsStore', () => {
  const hydrate = async (stored: Record<string, unknown>) => {
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend(new Map(Object.entries(stored))) },
      ],
    });
    const settings = TestBed.inject(SettingsStore);
    await TestBed.inject(Persist).ready();
    return settings;
  };

  it('restores valid stored settings', async () => {
    const s = await hydrate({ 'sw.location': loc, 'sw.autoTune': false, 'sw.pws': 'AA-01_b' });
    expect(s.location()?.label).toBe('31.22, -85.39');
    expect(s.autoTune()).toBe(false);
    expect(s.pws()).toBe('AA-01_b');
    expect(s.soundArmed()).toBe(false);
  });

  it('ignores corrupt stored settings', async () => {
    const s = await hydrate({ 'sw.location': 'x', 'sw.autoTune': 'no', 'sw.pws': 'bad id!' });
    expect(s.location()).toBeNull();
    expect(s.autoTune()).toBe(true);
    expect(s.pws()).toBeNull();
  });
});
