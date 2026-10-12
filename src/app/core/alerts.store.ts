import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';

import { AmbientService, type PwsStation, STALE_MS } from './ambient.service';
import { NhcService, type Storm } from './nhc.service';
import {
  dangerLabel,
  isDanger,
  type NwsAlert,
  NwsService,
  type Observation,
  type WarningShape,
} from './nws.service';
import { SettingsStore } from './settings.store';
import { Persist } from './storage/persist';
import { LineupStore } from '../iptv/lineup.store';

const POLL_MS = 60_000;
/** Tropical data changes with 3-6 hourly advisories and costs 15 requests, so poll it less often. */
const STORM_POLL_MS = 10 * 60_000;
/** Home weather stations upload every 1-5 minutes. */
const PWS_POLL_MS = 2 * 60_000;

export type Feed = 'alerts' | 'shapes' | 'observation' | 'storms' | 'pws';

/** Health of one feed: when it last succeeded and whether the latest attempt failed. */
export interface FeedState {
  okAt: Date | null;
  error: string | null;
}

const EMPTY: Record<Feed, FeedState> = {
  alerts: { okAt: null, error: null },
  shapes: { okAt: null, error: null },
  observation: { okAt: null, error: null },
  storms: { okAt: null, error: null },
  pws: { okAt: null, error: null },
};

/** Polls weather data for the home location and raises alarms on new danger alerts. */
@Injectable({ providedIn: 'root' })
export class AlertsStore {
  private readonly nws = inject(NwsService);
  private readonly nhc = inject(NhcService);
  private readonly ambient = inject(AmbientService);
  private readonly settings = inject(SettingsStore);
  private readonly lineup = inject(LineupStore);
  private readonly router = inject(Router);
  private readonly persist = inject(Persist);

  readonly alerts = signal<NwsAlert[]>([]);
  readonly shapes = signal<WarningShape[]>([]);
  readonly observation = signal<Observation | null>(null);
  readonly storms = signal<Storm[]>([]);
  /** Active Ambient Weather Network stations near home, nearest first. */
  readonly stations = signal<PwsStation[]>([]);
  /** The pinned station when it is reporting, otherwise the nearest active one. */
  readonly station = computed(() => {
    const list = this.stations();
    const pin = this.settings.pws();
    return (pin && list.find((s) => s.id === pin)) || list[0] || null;
  });
  readonly feeds = signal<Record<Feed, FeedState>>(EMPTY);

  /** Time of the last successful alert check (alerts are the feed that matters most). */
  readonly updatedAt = computed(() => this.feeds().alerts.okAt);
  readonly error = computed(() => {
    const f = this.feeds();
    if (f.alerts.error) {
      return f.alerts.okAt
        ? 'Alert feed unreachable, retrying (showing last good data)'
        : 'Alert feed unreachable, retrying';
    }
    // Home stations are a bonus feed; their outage is shown in the conditions card only.
    const failed = (Object.keys(f) as Feed[]).filter((k) => k !== 'pws' && f[k].error).length;
    return failed ? `${failed} feed(s) failed, retrying` : null;
  });

  readonly danger = computed(() => this.alerts().filter(isDanger));
  readonly dangerEvents = computed(() => [...new Set(this.danger().map(dangerLabel))]);

  /** Alert ids already announced, so reloads don't re-beep old alerts. */
  private readonly seen = this.persist.signal<string[]>('sw.seenAlerts', [], (v) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-300) : null,
  );
  private audio: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stormsAt = 0;
  private pwsAt = 0;
  /** Bumped on every location change; responses from an older generation are dropped. */
  private generation = 0;
  /** Feeds with a request still running; each feed has its own lock so a slow one never delays alerts. */
  private readonly busy = new Set<Feed>();

  constructor() {
    // Wait for stored state (seen alerts, lineup) before the first poll so old alerts don't re-alarm.
    const hydrated = signal(false);
    this.persist.ready().then(() => hydrated.set(true));
    effect(() => {
      const loc = this.settings.location();
      const ready = hydrated();
      clearInterval(this.timer);
      this.generation++;
      this.busy.clear();
      this.stormsAt = 0;
      this.pwsAt = 0;
      this.alerts.set([]);
      this.shapes.set([]);
      this.observation.set(null);
      this.stations.set([]);
      this.feeds.set(EMPTY);
      if (!loc || !ready) {
        return;
      }
      // Untracked: refresh reads other signals (e.g. stations), which must not re-run this effect.
      untracked(() => void this.refresh());
      this.timer = setInterval(async () => this.refresh(), POLL_MS);
    });
  }

  async refresh(): Promise<void> {
    const loc = this.settings.location();
    if (!loc) {
      return;
    }
    const gen = this.generation;
    const current = () => gen === this.generation;
    this.pruneStations();

    const track = async <T>(
      feed: Feed,
      run: () => Promise<T>,
      apply: (v: T) => void,
    ): Promise<void> => {
      if (this.busy.has(feed)) {
        return Promise.resolve();
      }
      this.busy.add(feed);
      return run()
        .then(
          (v) => {
            if (!current()) {
              return;
            }
            apply(v);
            this.feeds.update((f) => ({ ...f, [feed]: { okAt: new Date(), error: null } }));
          },
          (e: unknown) => {
            if (!current()) {
              return;
            }
            this.feeds.update((f) => ({
              ...f,
              [feed]: { ...f[feed], error: (e as Error)?.message ?? 'failed' },
            }));
          },
        )
        .finally(() => {
          if (current()) {
            this.busy.delete(feed);
          }
        });
    };

    const jobs = [
      track(
        'alerts',
        async () => this.nws.alertsAt(loc.lat, loc.lon),
        (a) => this.onAlerts(a),
      ),
      track(
        'shapes',
        async () => this.nws.warningShapes(),
        (s) => this.shapes.set(s),
      ),
      track(
        'observation',
        async () => this.nws.latestObservation(loc.stationsUrl, loc.lat, loc.lon),
        (o) => this.observation.set(o),
      ),
    ];
    if (Date.now() - this.stormsAt >= STORM_POLL_MS) {
      jobs.push(
        track(
          'storms',
          async () => this.nhc.activeStorms(),
          (s) => {
            this.storms.set(s);
            this.stormsAt = Date.now();
          },
        ),
      );
    }
    if (Date.now() - this.pwsAt >= PWS_POLL_MS) {
      jobs.push(
        track(
          'pws',
          async () => this.ambient.nearby(loc.lat, loc.lon),
          (s) => {
            this.stations.set(s);
            this.pwsAt = Date.now();
          },
        ),
      );
    }
    await Promise.all(jobs);
  }

  /** Drop home-station readings that have gone stale, e.g. while the Ambient feed is unreachable. */
  private pruneStations(): void {
    const cutoff = Date.now() - STALE_MS;
    if (this.stations().some((s) => s.at < cutoff)) {
      this.stations.update((list) => list.filter((s) => s.at >= cutoff));
    }
  }

  private onAlerts(alerts: NwsAlert[]): void {
    const firstLoad = this.feeds().alerts.okAt === null;
    this.alerts.set(alerts);
    const seen = new Set(this.seen());
    const fresh = alerts.filter((a) => !seen.has(a.id));
    if (fresh.length) {
      this.seen.set([...seen, ...fresh.map((a) => a.id)].slice(-300));
    }

    const freshDanger = fresh.filter(isDanger);
    if (freshDanger.length) {
      this.beep(6);
      freshDanger.forEach((a) => this.notify(dangerLabel(a), a.headline));
      const def = this.lineup.defaultChannel();
      // Stay on the Watch page or current dashboard if already there; otherwise open the first dashboard.
      // Existing query params (kiosk) are kept.
      if (this.settings.autoTune() && def) {
        const path = this.router.url.split('?')[0];
        if (path.startsWith('/watch')) {
          this.router.navigate(['/watch', def.key], { queryParamsHandling: 'preserve' });
        } else {
          const commands = path === '/' || path.startsWith('/d/') ? [] : ['/'];
          this.router.navigate(commands, {
            queryParams: { ch: def.key },
            queryParamsHandling: 'merge',
          });
        }
      }
    } else if (fresh.length && !firstLoad) {
      this.beep(1);
      fresh.forEach((a) => this.notify(`New alert: ${a.event}`, a.headline));
    }
  }

  /** Call from a click handler: browsers only allow audio after a user gesture. */
  async arm(): Promise<void> {
    this.audio ??= new AudioContext();
    await this.audio.resume();
    try {
      if ('Notification' in window) {
        await Notification.requestPermission();
      }
    } catch {
      /* unsupported */
    }
    this.settings.soundArmed.set(true);
    this.beep(1);
  }

  beep(n: number): void {
    const ctx = this.audio;
    if (!ctx) {
      return;
    }
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 ? 853 : 960; // EAS-style two-tone
      osc.connect(gain).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.5;
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.setValueAtTime(0, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.5);
    }
  }

  private notify(title: string, body: string): void {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, requireInteraction: true });
      }
    } catch {
      /* some mobile browsers require a service worker */
    }
  }
}
