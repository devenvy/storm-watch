import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { dangerLabel, isDanger, NwsAlert, NwsService, Observation, WarningShape } from './nws.service';
import { SettingsStore } from './settings.store';
import { NhcService, Storm } from './nhc.service';
import { Persist } from './storage/persist';
import { LineupStore } from '../iptv/lineup.store';

const POLL_MS = 60_000;
/** Tropical data changes with 3-6 hourly advisories and costs 15 requests, so poll it less often. */
const STORM_POLL_MS = 10 * 60_000;

export type Feed = 'alerts' | 'shapes' | 'observation' | 'storms';

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
};

/** Polls weather data for the home location and raises alarms on new danger alerts. */
@Injectable({ providedIn: 'root' })
export class AlertsStore {
  private readonly nws = inject(NwsService);
  private readonly nhc = inject(NhcService);
  private readonly settings = inject(SettingsStore);
  private readonly lineup = inject(LineupStore);
  private readonly router = inject(Router);
  private readonly persist = inject(Persist);

  readonly alerts = signal<NwsAlert[]>([]);
  readonly shapes = signal<WarningShape[]>([]);
  readonly observation = signal<Observation | null>(null);
  readonly storms = signal<Storm[]>([]);
  readonly feeds = signal<Record<Feed, FeedState>>(EMPTY);

  /** Time of the last successful alert check (alerts are the feed that matters most). */
  readonly updatedAt = computed(() => this.feeds().alerts.okAt);
  readonly error = computed(() => {
    const f = this.feeds();
    if (f.alerts.error) return f.alerts.okAt ? 'Alert feed unreachable, retrying (showing last good data)' : 'Alert feed unreachable, retrying';
    const failed = (Object.keys(f) as Feed[]).filter(k => f[k].error).length;
    return failed ? `${failed} feed(s) failed, retrying` : null;
  });

  readonly danger = computed(() => this.alerts().filter(isDanger));
  readonly dangerEvents = computed(() => [...new Set(this.danger().map(dangerLabel))]);

  /** Alert ids already announced, so reloads don't re-beep old alerts. */
  private readonly seen = this.persist.signal<string[]>('sw.seenAlerts', [],
    v => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-300) : null));
  private audio: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stormsAt = 0;
  /** Bumped on every location change; responses from an older generation are dropped. */
  private generation = 0;
  private inFlight = false;

  constructor() {
    // Wait for stored state (seen alerts, lineup) before the first poll so old alerts don't re-alarm.
    const hydrated = signal(false);
    this.persist.ready().then(() => hydrated.set(true));
    effect(() => {
      const loc = this.settings.location();
      const ready = hydrated();
      clearInterval(this.timer);
      this.generation++;
      this.inFlight = false;
      this.stormsAt = 0;
      this.alerts.set([]);
      this.shapes.set([]);
      this.observation.set(null);
      this.feeds.set(EMPTY);
      if (!loc || !ready) return;
      this.refresh();
      this.timer = setInterval(() => this.refresh(), POLL_MS);
    });
  }

  async refresh(): Promise<void> {
    const loc = this.settings.location();
    if (!loc || this.inFlight) return;
    const gen = this.generation;
    this.inFlight = true;
    const current = () => gen === this.generation;

    const track = <T>(feed: Feed, p: Promise<T>, apply: (v: T) => void): Promise<void> =>
      p.then(
        v => {
          if (!current()) return;
          apply(v);
          this.feeds.update(f => ({ ...f, [feed]: { okAt: new Date(), error: null } }));
        },
        (e: unknown) => {
          if (!current()) return;
          this.feeds.update(f => ({ ...f, [feed]: { ...f[feed], error: (e as Error)?.message ?? 'failed' } }));
        },
      );

    const jobs = [
      track('alerts', this.nws.alertsAt(loc.lat, loc.lon), a => this.onAlerts(a)),
      track('shapes', this.nws.warningShapes(), s => this.shapes.set(s)),
      track('observation', this.nws.latestObservation(loc.stationsUrl), o => this.observation.set(o)),
    ];
    if (Date.now() - this.stormsAt >= STORM_POLL_MS) {
      jobs.push(track('storms', this.nhc.activeStorms(), s => { this.storms.set(s); this.stormsAt = Date.now(); }));
    }
    await Promise.all(jobs);
    if (current()) this.inFlight = false;
  }

  private onAlerts(alerts: NwsAlert[]): void {
    const firstLoad = this.feeds().alerts.okAt === null;
    this.alerts.set(alerts);
    const seen = new Set(this.seen());
    const fresh = alerts.filter(a => !seen.has(a.id));
    if (fresh.length) this.seen.set([...seen, ...fresh.map(a => a.id)].slice(-300));

    const freshDanger = fresh.filter(isDanger);
    if (freshDanger.length) {
      this.beep(6);
      freshDanger.forEach(a => this.notify(dangerLabel(a), a.headline));
      const def = this.lineup.defaultChannel();
      // Stay on the Watch page or current dashboard if already there; otherwise open the first dashboard.
      // Existing query params (kiosk) are kept.
      if (this.settings.autoTune() && def) {
        const path = this.router.url.split('?')[0];
        if (path.startsWith('/watch')) {
          this.router.navigate(['/watch', def.key], { queryParamsHandling: 'preserve' });
        } else {
          const commands = path === '/' || path.startsWith('/d/') ? [] : ['/'];
          this.router.navigate(commands, { queryParams: { ch: def.key }, queryParamsHandling: 'merge' });
        }
      }
    } else if (fresh.length && !firstLoad) {
      this.beep(1);
      fresh.forEach(a => this.notify('New alert: ' + a.event, a.headline));
    }
  }

  /** Call from a click handler: browsers only allow audio after a user gesture. */
  async arm(): Promise<void> {
    this.audio ??= new AudioContext();
    await this.audio.resume();
    try { if ('Notification' in window) await Notification.requestPermission(); } catch { /* unsupported */ }
    this.settings.soundArmed.set(true);
    this.beep(1);
  }

  beep(n: number): void {
    const ctx = this.audio;
    if (!ctx) return;
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
    } catch { /* some mobile browsers require a service worker */ }
  }
}
