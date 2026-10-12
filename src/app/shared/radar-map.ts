import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  input,
  type OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

import {
  type RadarFrame,
  type RadarSet,
  type RadarSourceId,
  RadarSources,
} from '../core/radar-sources';

import type { WarningShape } from '../core/nws.service';

const SPEEDS = { slow: 1400, normal: 800, fast: 350 } as const;
type Speed = keyof typeof SPEEDS;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
function isSpeed(value: string): value is Speed {
  return Object.hasOwn(SPEEDS, value);
}
const REFRESH_MINUTES = 3;
const REFRESH_MS = REFRESH_MINUTES * MS_PER_MINUTE;
/** Frames within this many minutes of now are labelled "now". */
const NOW_WINDOW_MINUTES = 3;
const DEFAULT_ZOOM = 8;
/** Opacity of the radar frame being shown. */
const FRAME_OPACITY = 0.75;
/** Playback needs at least this many frames. */
const MIN_PLAYABLE_FRAMES = 2;
/** Playback lingers this many times longer on the newest observed frame and the final frame. */
const BOUNDARY_HOLD_FACTOR = 2.5;
const PERCENT = 100;
const MAX_TICKS = 9;
const COLORS: Record<string, string> = {
  'Tornado Warning': '#ff2d2d',
  'Severe Thunderstorm Warning': '#ff9f1a',
  'Flash Flood Warning': '#2ecc71',
  'Extreme Wind Warning': '#ff4fd8',
};

/**
 * Popup built from DOM text nodes: alert text comes from a remote feed and must not be parsed as HTML.
 * The feed can omit the headline even though the type says otherwise.
 */
function popup(event: string, headline: string | null | undefined): HTMLElement {
  const el = document.createElement('div');
  const b = el.appendChild(document.createElement('b'));
  b.textContent = event;
  el.appendChild(document.createElement('br'));
  el.appendChild(document.createTextNode(headline ?? ''));
  return el;
}

function relative(t: Date, now: number): string {
  const m = Math.round((t.getTime() - now) / MS_PER_MINUTE);
  if (Math.abs(m) < NOW_WINDOW_MINUTES) {
    return 'now';
  }
  const sign = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  return a < MINUTES_PER_HOUR
    ? `${sign}${a} min`
    : `${sign}${Math.floor(a / MINUTES_PER_HOUR)} h${a % MINUTES_PER_HOUR ? ` ${a % MINUTES_PER_HOUR} m` : ''}`;
}

function logReloadError(err: unknown): void {
  console.error('Radar reload failed', err);
}

/** Radar map with a scrubbable timeline over any RadarSources frame set, plus warning polygons. */
@Component({
  selector: 'sw-radar-map',
  imports: [DatePipe],
  templateUrl: './radar-map.html',
  styleUrl: './radar-map.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKey($event)' },
})
export class RadarMap implements OnDestroy {
  private readonly sources = inject(RadarSources);

  readonly center = input.required<[number, number]>();
  readonly shapes = input<WarningShape[]>([]);
  readonly source = input<RadarSourceId>('blend');
  readonly station = input('');
  readonly zoom = input(DEFAULT_ZOOM);

  protected readonly set = signal<RadarSet>({ frames: [], startIndex: 0 });
  /** Starts paused on the newest observed frame; playing is opt-in. */
  protected readonly playing = signal(false);
  protected readonly speed = signal<Speed>('normal');
  protected readonly index = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly now = signal(Date.now());

  protected readonly last = computed(() => Math.max(0, this.set().frames.length - 1));
  protected readonly frame = computed<RadarFrame | undefined>(
    () => this.set().frames[this.index()],
  );
  protected readonly ticks = computed(() => {
    const frames = this.set().frames;
    const every = Math.max(1, Math.ceil(frames.length / MAX_TICKS));
    return frames
      .map((f, i) => ({ f, i }))
      .filter((t) => t.i % every === 0 || t.i === frames.length - 1);
  });
  /** Where "now" falls on the slider, when the set spans past and future. */
  protected readonly nowPct = computed(() => {
    const s = this.set();
    return s.frames.some((f) => f.kind === 'forecast') && s.frames.length > 1
      ? this.pct(s.startIndex)
      : null;
  });

  private readonly el = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly ready = signal(false);
  private map?: L.Map;
  private layers: L.TileLayer[] = [];
  private readonly polys = L.layerGroup();
  private home?: L.CircleMarker;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private shown = -1;
  private loadSeq = 0;
  private resize?: ResizeObserver;

  constructor() {
    afterNextRender(() => {
      const map = L.map(this.el().nativeElement, { keyboard: false }).setView(
        this.center(),
        this.zoom(),
      );
      this.map = map;
      // Standard OSM tiles (no key), darkened via the .basemap CSS filter so radar colors stand out.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Radar: IEM/NWS, HRRR, RainViewer',
        maxZoom: 12,
        className: 'basemap',
      }).addTo(map);
      this.polys.addTo(map);
      this.home = L.circleMarker(this.center(), {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip('Home');
      this.resize = new ResizeObserver(() => {
        this.map?.invalidateSize();
      });
      this.resize.observe(this.el().nativeElement);
      this.timers.push(
        setInterval(() => {
          this.now.set(Date.now());
          this.reload(true).catch(logReloadError);
        }, REFRESH_MS),
      );
      this.ready.set(true);
    });

    // (Re)load frames when the source or station changes.
    effect(() => {
      this.source();
      this.station();
      if (this.ready()) {
        untracked(() => {
          this.reload(false).catch(logReloadError);
        });
      }
    });

    // Show the selected frame.
    effect(() => {
      const i = this.index();
      this.set();
      if (!this.ready() || !this.layers[i]) {
        return;
      }
      if (this.shown >= 0) {
        this.layers[this.shown]?.setOpacity(0);
      }
      this.layers[i].setOpacity(FRAME_OPACITY);
      this.shown = i;
    });

    // Playback; holds on the newest observed frame and the final frame so loop boundaries are obvious.
    effect((onCleanup) => {
      const frames = this.set().frames;
      if (!this.playing() || frames.length < MIN_PLAYABLE_FRAMES) {
        return;
      }
      const i = this.index();
      const hold = i === this.set().startIndex || i === this.last() ? BOUNDARY_HOLD_FACTOR : 1;
      const t = setTimeout(
        () => this.index.set((i + 1) % frames.length),
        SPEEDS[this.speed()] * hold,
      );
      onCleanup(() => clearTimeout(t));
    });

    effect(() => {
      const shapes = this.shapes();
      if (!this.ready()) {
        return;
      }
      this.polys.clearLayers();
      for (const s of shapes) {
        L.geoJSON(s.geometry, {
          style: { color: COLORS[s.event] ?? '#fff', weight: 2, fillOpacity: 0.18 },
        })
          .bindPopup(popup(s.event, s.headline))
          .addTo(this.polys);
      }
    });

    effect(() => {
      const c = this.center();
      if (!this.ready()) {
        return;
      }
      this.home?.setLatLng(c);
      this.map?.setView(c, this.map.getZoom());
    });
  }

  /**
   * Fetch frames. On periodic refreshes (`keepPosition`) a viewer parked on the newest
   * observed frame keeps following "latest"; one who scrubbed to another time stays there.
   */
  private async reload(keepPosition: boolean): Promise<void> {
    const seq = ++this.loadSeq;
    const followingLatest = !this.playing() && this.index() === this.set().startIndex;
    const prevTime = keepPosition && !followingLatest ? this.frame()?.time.getTime() : undefined;
    this.loading.set(true);
    try {
      const next = await this.sources.load(this.source(), this.station());
      if (seq !== this.loadSeq || !this.map) {
        return;
      }
      this.layers.forEach((l) => {
        l.remove();
      });
      // Every frame stays on the map at opacity 0 so tiles preload and scrubbing is instant.
      this.layers = next.frames.map((f) =>
        L.tileLayer(f.url, {
          opacity: 0,
          zIndex: 5,
          maxNativeZoom: next.maxNativeZoom,
          maxZoom: 12,
        }).addTo(this.map!),
      );
      this.shown = -1;
      this.set.set(next);
      const kept =
        prevTime === undefined ? -1 : next.frames.findIndex((f) => f.time.getTime() === prevTime);
      this.index.set(kept >= 0 ? kept : next.startIndex);
      this.error.set(null);
    } catch (e) {
      if (seq === this.loadSeq) {
        this.error.set(`Radar source unavailable: ${(e as Error).message}`);
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading.set(false);
      }
    }
  }

  protected setSpeed(value: string): void {
    if (isSpeed(value)) {
      this.speed.set(value);
    }
  }

  protected rel(t: Date): string {
    return relative(t, this.now());
  }

  protected pct(i: number): number {
    return this.last() ? (i / this.last()) * PERCENT : 0;
  }

  protected go(i: number): void {
    this.playing.set(false);
    this.index.set(Math.max(0, Math.min(this.last(), i)));
  }

  protected step(d: number): void {
    this.go(this.index() + d);
  }

  protected onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }
    if (e.key === 'ArrowLeft') {
      this.step(-1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      this.step(1);
      e.preventDefault();
    } else if (e.key === ' ') {
      this.playing.set(!this.playing());
      e.preventDefault();
    }
  }

  protected recenter(): void {
    this.map?.setView(this.center(), this.zoom());
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.resize?.disconnect();
    this.loadSeq++;
    this.map?.remove();
    this.map = undefined;
  }
}
