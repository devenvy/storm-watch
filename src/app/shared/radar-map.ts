import {
  afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, OnDestroy, signal, untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import * as L from 'leaflet';
import { WarningShape } from '../core/nws.service';
import { RadarFrame, RadarSet, RadarSourceId, RadarSources } from '../core/radar-sources';

const SPEEDS = { slow: 1400, normal: 800, fast: 350 } as const;
type Speed = keyof typeof SPEEDS;
const REFRESH_MS = 3 * 60_000;
const MAX_TICKS = 9;
const COLORS: Record<string, string> = {
  'Tornado Warning': '#ff2d2d',
  'Severe Thunderstorm Warning': '#ff9f1a',
  'Flash Flood Warning': '#2ecc71',
  'Extreme Wind Warning': '#ff4fd8',
};

/** Popup built from DOM text nodes: alert text comes from a remote feed and must not be parsed as HTML. */
function popup(event: string, headline: string): HTMLElement {
  const el = document.createElement('div');
  const b = el.appendChild(document.createElement('b'));
  b.textContent = event;
  el.appendChild(document.createElement('br'));
  el.appendChild(document.createTextNode(headline ?? ''));
  return el;
}

function relative(t: Date, now: number): string {
  const m = Math.round((t.getTime() - now) / 60_000);
  if (Math.abs(m) < 3) return 'now';
  const sign = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  return a < 60 ? `${sign}${a} min` : `${sign}${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} m` : ''}`;
}

/** Radar map with a scrubbable timeline over any RadarSources frame set, plus warning polygons. */
@Component({
  selector: 'sw-radar-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="mapwrap">
      <div #map class="map" tabindex="0" aria-label="Radar map"></div>
      @if (frame()?.kind === 'forecast') { <span class="badge">FORECAST · model</span> }
      @if (loading()) { <span class="badge loading">Loading…</span> }
      @if (error()) { <span class="badge err">{{ error() }}</span> }
    </div>
    <div class="timeline">
      <div class="controls">
        <button (click)="go(0)" title="First" aria-label="First frame">⏮</button>
        <button (click)="step(-1)" title="Back (←)" aria-label="Previous frame">◀</button>
        <button class="play" (click)="playing.set(!playing())" [attr.aria-label]="playing() ? 'Pause' : 'Play'">
          {{ playing() ? '⏸' : '▶' }}</button>
        <button (click)="step(1)" title="Forward (→)" aria-label="Next frame">▶</button>
        <button (click)="go(set().startIndex)" title="Latest observed" aria-label="Latest observed frame">●</button>
        <button (click)="go(last())" title="Last" aria-label="Last frame">⏭</button>
        @if (frame(); as f) {
          <span class="time" [class.future]="f.kind === 'forecast'">
            <b>{{ f.time | date: 'h:mm a' }}</b><small>{{ rel(f.time) }}</small>
          </span>
        }
        <select [value]="speed()" (change)="speed.set($any($event.target).value)" aria-label="Playback speed">
          <option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option>
        </select>
      </div>
      <div class="track">
        @if (nowPct() !== null) { <span class="nowline" [style.left.%]="nowPct()" title="Now"></span> }
        <input type="range" min="0" [max]="last()" step="1" [value]="index()"
          (input)="go(+$any($event.target).value)" aria-label="Radar time">
      </div>
      <div class="ticks">
        @for (t of ticks(); track t.i) {
          <button class="tick" [class.on]="t.i === index()" [class.future]="t.f.kind === 'forecast'"
            [style.left.%]="pct(t.i)" (click)="go(t.i)">{{ t.f.time | date: 'h:mm' }}</button>
        }
      </div>
      <div class="legend">
        <i style="background:#ff2d2d"></i>Tornado
        <i style="background:#ff9f1a"></i>Svr T-storm
        <i style="background:#2ecc71"></i>Flash flood
        <i style="background:#ff4fd8"></i>Ext. wind
        @if (set().note) { <span class="note">{{ set().note }}</span> }
        <button class="link" (click)="recenter()">Recenter</button>
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; }
    .mapwrap { flex: 1; min-height: 220px; position: relative; }
    .map { position: absolute; inset: 0; border-radius: 6px; background: #111; }
    :host ::ng-deep .basemap { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.4); }
    .badge { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 500; padding: 3px 10px; border-radius: 4px;
      background: #6e40c9; color: #fff; font-size: 12px; font-weight: 700; letter-spacing: .05em; pointer-events: none; }
    .badge.loading { background: #21262d; top: auto; bottom: 8px; }
    .badge.err { background: var(--red); top: auto; bottom: 8px; }
    .timeline { display: flex; flex-direction: column; gap: 2px; }
    .controls { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
    .controls button { padding: 4px 9px; min-width: 34px; }
    .play { border-color: var(--blue); }
    .time { display: flex; gap: 6px; align-items: baseline; margin: 0 6px; font-variant-numeric: tabular-nums; }
    .time b { font-size: 18px; } .time small { color: var(--muted); }
    .time.future b, .time.future small { color: #b392f0; }
    .controls select { margin-left: auto; padding: 4px 6px; }
    .track { position: relative; }
    .track input { width: 100%; accent-color: var(--blue); position: relative; }
    .nowline { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--yellow); pointer-events: none; margin-left: 7px; }
    .ticks { position: relative; height: 16px; margin: 0 7px; }
    .tick { position: absolute; transform: translateX(-50%); background: none; border: none; padding: 0 2px;
      font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tick.future { color: #8b72c9; }
    .tick.on { color: var(--fg); font-weight: 700; }
    .legend { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
    .legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .note { color: #b392f0; }
    .link { margin-left: auto; padding: 2px 8px; font-size: 12px; }
  `,
})
export class RadarMap implements OnDestroy {
  readonly center = input.required<[number, number]>();
  readonly shapes = input<WarningShape[]>([]);
  readonly source = input<RadarSourceId>('blend');
  readonly station = input('');
  readonly zoom = input(8);

  private readonly sources = inject(RadarSources);

  protected readonly set = signal<RadarSet>({ frames: [], startIndex: 0 });
  /** Starts paused on the newest observed frame; playing is opt-in. */
  protected readonly playing = signal(false);
  protected readonly speed = signal<Speed>('normal');
  protected readonly index = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly now = signal(Date.now());

  protected readonly last = computed(() => Math.max(0, this.set().frames.length - 1));
  protected readonly frame = computed<RadarFrame | undefined>(() => this.set().frames[this.index()]);
  protected readonly ticks = computed(() => {
    const frames = this.set().frames;
    const every = Math.max(1, Math.ceil(frames.length / MAX_TICKS));
    return frames.map((f, i) => ({ f, i })).filter(t => t.i % every === 0 || t.i === frames.length - 1);
  });
  /** Where "now" falls on the slider, when the set spans past and future. */
  protected readonly nowPct = computed(() => {
    const s = this.set();
    return s.frames.some(f => f.kind === 'forecast') && s.frames.length > 1 ? this.pct(s.startIndex) : null;
  });

  private readonly el = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly ready = signal(false);
  private map?: L.Map;
  private layers: L.TileLayer[] = [];
  private polys = L.layerGroup();
  private home?: L.CircleMarker;
  private timers: ReturnType<typeof setInterval>[] = [];
  private shown = -1;
  private loadSeq = 0;
  private resize?: ResizeObserver;

  constructor() {
    afterNextRender(() => {
      const map = (this.map = L.map(this.el().nativeElement, { keyboard: false }).setView(this.center(), this.zoom()));
      // Standard OSM tiles (no key), darkened via the .basemap CSS filter so radar colors stand out.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Radar: IEM/NWS, HRRR, RainViewer',
        maxZoom: 12,
        className: 'basemap',
      }).addTo(map);
      this.polys.addTo(map);
      this.home = L.circleMarker(this.center(), { radius: 7, color: '#fff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1 })
        .addTo(map).bindTooltip('Home');
      this.resize = new ResizeObserver(() => this.map?.invalidateSize());
      this.resize.observe(this.el().nativeElement);
      this.timers.push(setInterval(() => { this.now.set(Date.now()); this.reload(true); }, REFRESH_MS));
      this.ready.set(true);
    });

    // (Re)load frames when the source or station changes.
    effect(() => {
      this.source();
      this.station();
      if (this.ready()) untracked(() => this.reload(false));
    });

    // Show the selected frame.
    effect(() => {
      const i = this.index();
      this.set();
      if (!this.ready() || !this.layers[i]) return;
      if (this.shown >= 0 && this.layers[this.shown]) this.layers[this.shown].setOpacity(0);
      this.layers[i].setOpacity(0.75);
      this.shown = i;
    });

    // Playback; holds on the newest observed frame and the final frame so loop boundaries are obvious.
    effect(onCleanup => {
      const frames = this.set().frames;
      if (!this.playing() || frames.length < 2) return;
      const i = this.index();
      const hold = i === this.set().startIndex || i === this.last() ? 2.5 : 1;
      const t = setTimeout(() => this.index.set((i + 1) % frames.length), SPEEDS[this.speed()] * hold);
      onCleanup(() => clearTimeout(t));
    });

    effect(() => {
      const shapes = this.shapes();
      if (!this.ready()) return;
      this.polys.clearLayers();
      for (const s of shapes) {
        L.geoJSON(s.geometry, { style: { color: COLORS[s.event] ?? '#fff', weight: 2, fillOpacity: 0.18 } })
          .bindPopup(popup(s.event, s.headline))
          .addTo(this.polys);
      }
    });

    effect(() => {
      const c = this.center();
      if (!this.ready()) return;
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
      if (seq !== this.loadSeq || !this.map) return;
      this.layers.forEach(l => l.remove());
      // Every frame stays on the map at opacity 0 so tiles preload and scrubbing is instant.
      this.layers = next.frames.map(f =>
        L.tileLayer(f.url, { opacity: 0, zIndex: 5, maxNativeZoom: next.maxNativeZoom, maxZoom: 12 }).addTo(this.map!));
      this.shown = -1;
      this.set.set(next);
      const kept = prevTime === undefined ? -1 : next.frames.findIndex(f => f.time.getTime() === prevTime);
      this.index.set(kept >= 0 ? kept : next.startIndex);
      this.error.set(null);
    } catch (e) {
      if (seq === this.loadSeq) this.error.set('Radar source unavailable: ' + (e as Error).message);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected rel(t: Date): string {
    return relative(t, this.now());
  }

  protected pct(i: number): number {
    return this.last() ? (i / this.last()) * 100 : 0;
  }

  protected go(i: number): void {
    this.playing.set(false);
    this.index.set(Math.max(0, Math.min(this.last(), i)));
  }

  protected step(d: number): void {
    this.go(this.index() + d);
  }

  protected onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { this.step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { this.step(1); e.preventDefault(); }
    else if (e.key === ' ') { this.playing.set(!this.playing()); e.preventDefault(); }
  }

  protected recenter(): void {
    this.map?.setView(this.center(), this.zoom());
  }

  ngOnDestroy(): void {
    this.timers.forEach(t => clearInterval(t));
    this.resize?.disconnect();
    this.loadSeq++;
    this.map?.remove();
    this.map = undefined;
  }
}
