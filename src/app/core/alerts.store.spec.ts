import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AlertsStore } from './alerts.store';
import { AmbientService, type PwsStation } from './ambient.service';
import { NhcService, type Storm } from './nhc.service';
import { dangerLabel, isDanger, type NwsAlert, NwsService, type Observation } from './nws.service';
import { type HomeLocation, SettingsStore } from './settings.store';
import { Persist } from './storage/persist';
import { STORAGE_BACKEND, type StorageBackend } from './storage/storage-backend';
import { LineupStore } from '../iptv/lineup.store';

import type { Mock } from 'vitest';

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

const alert = (id: string, event: string, parameters?: NwsAlert['parameters']): NwsAlert => ({
  id,
  event,
  parameters,
  severity: 'Severe',
  headline: event,
  description: '',
  instruction: '',
  areaDesc: '',
  senderName: '',
  ends: null,
  expires: '',
});

const place = (lat: number): HomeLocation => ({
  lat,
  lon: -85,
  label: `L${lat}`,
  city: '',
  state: '',
  office: 'TAE',
  radarStation: 'KEOX',
  stationsUrl: 'https://api.weather.gov/x',
});

describe('danger classification', () => {
  it('treats CATASTROPHIC flash flood / tornado warnings as emergencies', () => {
    const ffe = alert('1', 'Flash Flood Warning', { flashFloodDamageThreat: ['CATASTROPHIC'] });
    const tor = alert('2', 'Tornado Warning', { tornadoDamageThreat: ['CATASTROPHIC'] });
    expect(isDanger(ffe)).toBe(true);
    expect(dangerLabel(ffe)).toBe('Flash Flood Emergency');
    expect(dangerLabel(tor)).toBe('Tornado Emergency');
    expect(
      isDanger(alert('3', 'Flash Flood Warning', { flashFloodDamageThreat: ['CONSIDERABLE'] })),
    ).toBe(false);
    expect(isDanger(alert('4', 'Flood Watch'))).toBe(false);
  });
});

describe('AlertsStore', () => {
  it('drops responses that arrive after the location changed', async () => {
    const pending = new Map<number, (a: NwsAlert[]) => void>();
    const nws = {
      alertsAt: async (lat: number) =>
        new Promise<NwsAlert[]>((r) => {
          pending.set(lat, r);
        }),
      warningShapes: async () => [],
      latestObservation: async () =>
        new Promise(() => {
          /* never settles */
        }),
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
    await new Promise((r) => {
      setTimeout(r);
    });
    TestBed.tick();
    await new Promise((r) => {
      setTimeout(r);
    });
    expect(pending.has(30)).toBe(true);

    settings.location.set(place(31));
    TestBed.tick();
    await new Promise((r) => {
      setTimeout(r);
    });
    expect(pending.has(31)).toBe(true);

    // The old location answers last: it must not replace the new location's alerts.
    pending.get(31)!([alert('new', 'Flood Watch')]);
    await new Promise((r) => {
      setTimeout(r);
    });
    pending.get(30)!([alert('old', 'Tornado Warning')]);
    await new Promise((r) => {
      setTimeout(r);
    });

    expect(store.alerts().map((a) => a.id)).toEqual(['new']);
    expect(store.danger()).toEqual([]);
  });

  it('does not restart polling when home-station data arrives', async () => {
    let alertCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        {
          provide: NwsService,
          useValue: {
            alertsAt: async () => {
              alertCalls++;
              return [];
            },
            warningShapes: async () => [],
            latestObservation: async () =>
              new Promise(() => {
                /* never settles */
              }),
          },
        },
        { provide: NhcService, useValue: { activeStorms: async () => [] } },
        { provide: AmbientService, useValue: { nearby: async () => [] } },
      ],
    });
    const settings = TestBed.inject(SettingsStore);
    TestBed.inject(AlertsStore);
    settings.location.set(place(30));
    for (let i = 0; i < 5; i++) {
      TestBed.tick();
      await new Promise((r) => {
        setTimeout(r);
      });
    }
    expect(alertCalls).toBe(1);
  });
});

describe('AlertsStore polling', () => {
  const GRANTED: NotificationPermission = 'granted';
  const shown: { title: string; body?: string }[] = [];
  function showNotification(title: string, opts?: NotificationOptions): void {
    shown.push({ title, body: opts?.body });
  }
  const notificationStatics: {
    permission: NotificationPermission;
    requestPermission: Mock<() => Promise<NotificationPermission>>;
  } = { permission: GRANTED, requestPermission: vi.fn(async () => GRANTED) };
  const FakeNotification = Object.assign(vi.fn(showNotification), notificationStatics);

  const fakeAudio = () => {
    const frequencies: number[] = [];
    return {
      currentTime: 0,
      destination: {},
      frequencies,
      resume: vi.fn<() => Promise<void>>(async () => undefined),
      createOscillator: () => {
        const osc = {
          frequency: { value: 0 },
          connect: (g: unknown) => g,
          start: vi.fn<(t: number) => void>(),
          stop: () => {
            frequencies.push(osc.frequency.value);
          },
        };
        return osc;
      },
      createGain: () => ({
        gain: { setValueAtTime: vi.fn<(v: number, t: number) => void>() },
        connect: (d: unknown) => d,
      }),
    };
  };
  let audio: ReturnType<typeof fakeAudio> | undefined;
  function createAudio() {
    audio = fakeAudio();
    return audio;
  }
  const FakeAudioContext = vi.fn(createAudio);

  const obs = { station: 'KDHN' } as Observation;
  const pws = (id: string, at: number) => ({ id, at }) as PwsStation;

  let nws: {
    alertsAt: Mock<NwsService['alertsAt']>;
    warningShapes: Mock<NwsService['warningShapes']>;
    latestObservation: Mock<NwsService['latestObservation']>;
  };
  let nhc: { activeStorms: Mock<NhcService['activeStorms']> };
  let ambient: { nearby: Mock<AmbientService['nearby']> };
  let settings: SettingsStore;
  let lineup: LineupStore;
  let router: Router;

  const flush = async () => {
    for (let i = 0; i < 5; i++) {
      TestBed.tick();
      await new Promise((r) => {
        setTimeout(r);
      });
    }
  };

  /** Creates the store with the home location set and waits for the first poll. */
  const start = async () => {
    const store = TestBed.inject(AlertsStore);
    settings.location.set(place(30));
    await flush();
    return store;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 10, 12));
    shown.length = 0;
    FakeNotification.permission = GRANTED;
    audio = undefined;
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    nws = {
      alertsAt: vi.fn<NwsService['alertsAt']>(async () => []),
      warningShapes: vi.fn<NwsService['warningShapes']>(async () => []),
      latestObservation: vi.fn<NwsService['latestObservation']>(async () => obs),
    };
    nhc = { activeStorms: vi.fn<NhcService['activeStorms']>(async () => []) };
    ambient = { nearby: vi.fn<AmbientService['nearby']>(async () => []) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: NwsService, useValue: nws },
        { provide: NhcService, useValue: nhc },
        { provide: AmbientService, useValue: ambient },
      ],
    });
    settings = TestBed.inject(SettingsStore);
    lineup = TestBed.inject(LineupStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not poll without a home location', async () => {
    const store = TestBed.inject(AlertsStore);
    await flush();
    await store.refresh();
    expect(nws.alertsAt).not.toHaveBeenCalled();
    expect(store.error()).toBeNull();
  });

  it('loads every feed and records when each succeeded', async () => {
    const storm = { id: 'AL01' } as Storm;
    nhc.activeStorms.mockResolvedValue([storm]);
    nws.warningShapes.mockResolvedValue([
      { event: 'Tornado Warning', headline: 'h', geometry: { type: 'Point', coordinates: [0, 0] } },
    ]);
    const store = await start();
    expect(nws.alertsAt).toHaveBeenCalledWith(30, -85);
    expect(nws.latestObservation).toHaveBeenCalledWith('https://api.weather.gov/x', 30, -85);
    expect(store.observation()).toBe(obs);
    expect(store.storms()).toEqual([storm]);
    expect(store.shapes()).toHaveLength(1);
    expect(store.updatedAt()).toEqual(new Date(Date.UTC(2026, 9, 10, 12)));
    expect(Object.values(store.feeds()).every((f) => f.okAt !== null)).toBe(true);
    expect(store.error()).toBeNull();
  });

  it('polls every minute but storms and home stations less often', async () => {
    await start();
    expect(nws.alertsAt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(nws.alertsAt).toHaveBeenCalledTimes(2);
    expect(nhc.activeStorms).toHaveBeenCalledTimes(1);
    expect(ambient.nearby).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(ambient.nearby).toHaveBeenCalledTimes(2);
    expect(nhc.activeStorms).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    await flush();
    expect(nhc.activeStorms).toHaveBeenCalledTimes(2);
  });

  it('never runs two requests for the same feed at once', async () => {
    let answer!: (a: NwsAlert[]) => void;
    nws.alertsAt.mockImplementation(
      async () =>
        new Promise((r) => {
          answer = r;
        }),
    );
    const store = await start();
    await store.refresh();
    expect(nws.alertsAt).toHaveBeenCalledTimes(1);
    expect(nws.warningShapes).toHaveBeenCalledTimes(2);
    answer([]);
    await flush();
    nws.alertsAt.mockResolvedValue([]);
    await store.refresh();
    expect(nws.alertsAt).toHaveBeenCalledTimes(2);
  });

  it('reports feed failures, keeping the last good data', async () => {
    const store = await start();
    nws.alertsAt.mockRejectedValue(new Error('NWS 503'));
    await store.refresh();
    expect(store.feeds().alerts.error).toBe('NWS 503');
    expect(store.error()).toBe('Alert feed unreachable, retrying (showing last good data)');

    nws.alertsAt.mockResolvedValue([]);
    nws.warningShapes.mockRejectedValue(null);
    await store.refresh();
    expect(store.feeds().shapes.error).toBe('failed');
    expect(store.error()).toBe('1 feed(s) failed, retrying');
  });

  it('says the alert feed is down when it never loaded', async () => {
    nws.alertsAt.mockRejectedValue(new Error('down'));
    const store = await start();
    expect(store.error()).toBe('Alert feed unreachable, retrying');
  });

  it('does not count a home-station outage as a feed failure', async () => {
    ambient.nearby.mockRejectedValue(new Error('Ambient 500'));
    const store = await start();
    expect(store.feeds().pws.error).toBe('Ambient 500');
    expect(store.error()).toBeNull();
  });

  it('prefers the pinned home station and drops stale readings', async () => {
    const now = Date.now();
    ambient.nearby.mockResolvedValue([pws('a', now), pws('b', now - 10 * 60_000)]);
    const store = await start();
    expect(store.station()?.id).toBe('a');
    settings.pws.set('b');
    expect(store.station()?.id).toBe('b');
    settings.pws.set('gone');
    expect(store.station()?.id).toBe('a');

    // 25 minutes later "b" is older than 30 minutes and the Ambient feed is not polled yet.
    ambient.nearby.mockRejectedValue(new Error('down'));
    vi.setSystemTime(now + 25 * 60_000);
    await store.refresh();
    expect(store.stations().map((s) => s.id)).toEqual(['a']);
  });

  it('beeps and notifies for new alerts after the first load only', async () => {
    const store = await start();
    await store.arm();
    expect(settings.soundArmed()).toBe(true);
    expect(FakeNotification.requestPermission).toHaveBeenCalledWith();
    const ctx = audio!;
    expect(ctx.resume).toHaveBeenCalledWith();
    expect(ctx.frequencies).toEqual([960]);

    nws.alertsAt.mockResolvedValue([alert('a1', 'Flood Watch')]);
    await store.refresh();
    expect(ctx.frequencies).toEqual([960, 960]);
    expect(shown).toEqual([{ title: 'New alert: Flood Watch', body: 'Flood Watch' }]);

    // Already announced: no second alarm.
    await store.refresh();
    expect(ctx.frequencies).toHaveLength(2);
  });

  it('stays quiet about alerts already active at the first load', async () => {
    nws.alertsAt.mockResolvedValue([alert('a1', 'Flood Watch')]);
    await start();
    expect(shown).toEqual([]);
  });

  it('sounds the two-tone alarm and auto-tunes on a danger alert', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    lineup.add({ key: 'x1', name: 'One', url: 'http://tv.example/1' });
    const store = await start();
    await store.arm();
    nws.alertsAt.mockResolvedValue([alert('t1', 'Tornado Warning')]);
    await store.refresh();
    expect(audio!.frequencies.slice(1)).toEqual([960, 853, 960, 853, 960, 853]);
    expect(shown).toEqual([{ title: 'Tornado Warning', body: 'Tornado Warning' }]);
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { ch: 'x1' },
      queryParamsHandling: 'merge',
    });
    expect(store.dangerEvents()).toEqual(['Tornado Warning']);
  });

  it('switches channel in place on the Watch page', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/watch/x9?kiosk=1');
    lineup.add({ key: 'x1', name: 'One', url: 'http://tv.example/1' });
    const store = await start();
    nws.alertsAt.mockResolvedValue([alert('t1', 'Tornado Warning')]);
    await store.refresh();
    expect(navigate).toHaveBeenCalledWith(['/watch', 'x1'], { queryParamsHandling: 'preserve' });
  });

  it('opens the dashboard from other pages and logs navigation failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const navigate = vi.spyOn(router, 'navigate').mockRejectedValue(new Error('nav'));
    vi.spyOn(router, 'url', 'get').mockReturnValue('/setup');
    lineup.add({ key: 'x1', name: 'One', url: 'http://tv.example/1' });
    const store = await start();
    nws.alertsAt.mockResolvedValue([alert('t1', 'Tornado Warning')]);
    await store.refresh();
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/'], {
      queryParams: { ch: 'x1' },
      queryParamsHandling: 'merge',
    });
    expect(error).toHaveBeenCalledWith(
      'Storm Watch: auto-tune navigation failed',
      expect.any(Error),
    );
  });

  it('logs a failed Watch-page auto-tune', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(router, 'navigate').mockRejectedValue(new Error('nav'));
    vi.spyOn(router, 'url', 'get').mockReturnValue('/watch');
    lineup.add({ key: 'x1', name: 'One', url: 'http://tv.example/1' });
    const store = await start();
    nws.alertsAt.mockResolvedValue([alert('t1', 'Tornado Warning')]);
    await store.refresh();
    await flush();
    expect(error).toHaveBeenCalledWith(
      'Storm Watch: auto-tune navigation failed',
      expect.any(Error),
    );
  });

  it('does not auto-tune when disabled or without channels', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const store = await start();
    nws.alertsAt.mockResolvedValue([alert('t1', 'Tornado Warning')]);
    await store.refresh();
    settings.autoTune.set(false);
    lineup.add({ key: 'x1', name: 'One', url: 'http://tv.example/1' });
    nws.alertsAt.mockResolvedValue([alert('t2', 'Tornado Warning')]);
    await store.refresh();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('skips notifications without permission and stays silent before arming', async () => {
    FakeNotification.permission = 'denied';
    const store = await start();
    nws.alertsAt.mockResolvedValue([alert('a1', 'Flood Watch')]);
    await store.refresh();
    expect(shown).toEqual([]);
    expect(audio).toBeUndefined();
  });

  function illegalConstructor(): never {
    throw new TypeError('Illegal constructor');
  }

  it('arms audio even when notifications are unsupported or throw', async () => {
    const store = await start();
    FakeNotification.requestPermission.mockRejectedValueOnce(new Error('unsupported'));
    await store.arm();
    expect(settings.soundArmed()).toBe(true);
    vi.stubGlobal(
      'Notification',
      Object.assign(vi.fn(illegalConstructor), { permission: 'granted' }),
    );
    nws.alertsAt.mockResolvedValue([alert('a1', 'Flood Watch')]);
    await store.refresh();
    expect(audio!.frequencies).toEqual([960, 960]);
  });

  it('logs a storage hydration failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Persist.prototype, 'ready').mockRejectedValue(new Error('idb'));
    TestBed.inject(AlertsStore);
    await flush();
    expect(error).toHaveBeenCalledWith('Storm Watch: storage hydration failed', expect.any(Error));
  });
});
