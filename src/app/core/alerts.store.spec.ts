import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertsStore } from './alerts.store';
import { dangerLabel, isDanger, NwsAlert, NwsService } from './nws.service';
import { NhcService } from './nhc.service';
import { AmbientService } from './ambient.service';
import { HomeLocation, SettingsStore } from './settings.store';
import { STORAGE_BACKEND, StorageBackend } from './storage/storage-backend';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  async get<T>() { return undefined as T | undefined; }
  async set() { /* no-op */ }
  async remove() { /* no-op */ }
}

const alert = (id: string, event: string, parameters?: NwsAlert['parameters']): NwsAlert => ({
  id, event, parameters, severity: 'Severe', headline: event, description: '', instruction: '',
  areaDesc: '', senderName: '', ends: null, expires: '',
});

const place = (lat: number): HomeLocation => ({
  lat, lon: -85, label: `L${lat}`, city: '', state: '', office: 'TAE', radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/x',
});

describe('danger classification', () => {
  it('treats CATASTROPHIC flash flood / tornado warnings as emergencies', () => {
    const ffe = alert('1', 'Flash Flood Warning', { flashFloodDamageThreat: ['CATASTROPHIC'] });
    const tor = alert('2', 'Tornado Warning', { tornadoDamageThreat: ['CATASTROPHIC'] });
    expect(isDanger(ffe)).toBe(true);
    expect(dangerLabel(ffe)).toBe('Flash Flood Emergency');
    expect(dangerLabel(tor)).toBe('Tornado Emergency');
    expect(isDanger(alert('3', 'Flash Flood Warning', { flashFloodDamageThreat: ['CONSIDERABLE'] }))).toBe(false);
    expect(isDanger(alert('4', 'Flood Watch'))).toBe(false);
  });
});

describe('AlertsStore', () => {
  it('drops responses that arrive after the location changed', async () => {
    const pending = new Map<number, (a: NwsAlert[]) => void>();
    const nws = {
      alertsAt: (lat: number) => new Promise<NwsAlert[]>(r => pending.set(lat, r)),
      warningShapes: async () => [],
      latestObservation: () => new Promise(() => undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: NwsService, useValue: nws },
        { provide: NhcService, useValue: { activeStorms: async () => [] } },
      ],
    });
    const settings = TestBed.inject(SettingsStore);
    const store = TestBed.inject(AlertsStore);
    settings.location.set(place(30));
    await new Promise(r => setTimeout(r));
    TestBed.tick();
    await new Promise(r => setTimeout(r));
    expect(pending.has(30)).toBe(true);

    settings.location.set(place(31));
    TestBed.tick();
    await new Promise(r => setTimeout(r));
    expect(pending.has(31)).toBe(true);

    // The old location answers last: it must not replace the new location's alerts.
    pending.get(31)!([alert('new', 'Flood Watch')]);
    await new Promise(r => setTimeout(r));
    pending.get(30)!([alert('old', 'Tornado Warning')]);
    await new Promise(r => setTimeout(r));

    expect(store.alerts().map(a => a.id)).toEqual(['new']);
    expect(store.danger()).toEqual([]);
  });

  it('does not restart polling when home-station data arrives', async () => {
    let alertCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: NwsService, useValue: { alertsAt: async () => { alertCalls++; return []; }, warningShapes: async () => [], latestObservation: () => new Promise(() => undefined) } },
        { provide: NhcService, useValue: { activeStorms: async () => [] } },
        { provide: AmbientService, useValue: { nearby: async () => [] } },
      ],
    });
    const settings = TestBed.inject(SettingsStore);
    TestBed.inject(AlertsStore);
    settings.location.set(place(30));
    for (let i = 0; i < 5; i++) { TestBed.tick(); await new Promise(r => setTimeout(r)); }
    expect(alertCalls).toBe(1);
  });
});
