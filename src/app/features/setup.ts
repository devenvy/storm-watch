import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BoardsStore } from '../core/boards.store';
import { NwsService } from '../core/nws.service';
import { SettingsStore } from '../core/settings.store';
import { ShareService } from '../core/share';
import { LineupStore } from '../iptv/lineup.store';
import { suggest } from '../iptv/scoring';
import { type XtreamAccount, xtreamLogin } from '../iptv/sources';
import { ChannelLogo } from '../shared/channel-logo';

import type { Source } from '../iptv/models';

interface GeoResult {
  name: string;
  admin1?: string;
  country_code: string;
  latitude: number;
  longitude: number;
}

@Component({
  selector: 'sw-setup',
  imports: [RouterLink, DatePipe, DecimalPipe, ChannelLogo],
  template: `
    <div class="wrap">
      <!-- 1. Location -->
      <section class="panel" id="location">
        <h2>1 · Location</h2>
        @if (settings.location(); as loc) {
          <p>Monitoring <b>{{ loc.label }}</b> · NWS office {{ loc.office }} · radar {{ loc.radarStation }}</p>
        }
        <div class="row">
          <input #q placeholder="City or ZIP (US)" (keyup.enter)="search(q.value)">
          <button (click)="search(q.value)">Search</button>
          <button (click)="useGps()">Use my location</button>
        </div>
        @if (locError()) { <p class="err">{{ locError() }}</p> }
        @for (r of geoResults(); track $index) {
          <button class="pick" (click)="pick(r.latitude, r.longitude)">
            {{ r.name }}, {{ r.admin1 }} ({{ r.country_code }})
          </button>
        }
        <label class="check"><input type="checkbox" [checked]="settings.autoTune()"
          (change)="settings.autoTune.set($any($event.target).checked)">
          Auto-open the default channel when a Tornado Warning (or similar) is issued</label>
      </section>

      <!-- 2. IPTV source -->
      <section class="panel" id="iptv">
        <h2>2 · IPTV source <small class="muted">(optional, stays on this device)</small></h2>
        <div class="row">
          <select #kind [value]="lineup.source()?.kind ?? 'xtream'" (change)="kindSel.set($any($event.target).value)">
            <option value="xtream">Xtream Codes</option>
            <option value="m3u">M3U playlist URL</option>
          </select>
        </div>
        @if (kindSel() === 'xtream') {
          <div class="form">
            <input #server placeholder="Server, e.g. http://host:8080" [value]="xt()?.server ?? ''">
            <input #user placeholder="Username" autocomplete="off" [value]="xt()?.username ?? ''">
            <input #pass type="password" placeholder="Password" autocomplete="off" [value]="xt()?.password ?? ''">
            <button [disabled]="busy()" (click)="connectXtream(server.value, user.value, pass.value)">Connect</button>
          </div>
        } @else {
          <div class="form">
            <input #m3u placeholder="https://…/playlist.m3u" [value]="m3uUrl()">
            <button [disabled]="busy()" (click)="connectM3u(m3u.value)">Load</button>
          </div>
        }
        @if (account(); as a) {
          <p class="ok">Connected · {{ a.status }} · {{ a.activeConnections }}/{{ a.maxConnections }} connections in use
            @if (a.expires) { · expires {{ a.expires | date: 'mediumDate' }} }</p>
        }
        @if (lineup.catalogLoading()) { <p class="muted">Loading channel list…</p> }
        @if (lineup.catalogError() ?? sourceError(); as err) { <p class="err">{{ err }}</p> }
        @if (lineup.catalog().length) { <p class="muted">{{ lineup.catalog().length | number }} channels available.</p> }
      </section>

      <!-- 3. Suggestions + search -->
      @if (lineup.catalog().length) {
        <section class="panel">
          <h2>3 · Suggested for {{ settings.location()?.city || 'you' }}</h2>
          <p class="muted">Ranked by local/news/weather signals. Tick what you want in your storm lineup.</p>
          <div class="list">
            @for (s of suggestions(); track s.channel.key) {
              <label class="item">
                <input type="checkbox" [checked]="lineup.keys().has(s.channel.key)" (change)="lineup.toggle(s.channel)">
                <sw-logo [src]="s.channel.logo" [name]="s.channel.name" />
                <span class="name">{{ s.channel.name }}<small>{{ s.channel.category }}</small></span>
                <span class="why">{{ s.reasons.join(' · ') }}</span>
              </label>
            } @empty { <p class="muted">No strong matches. Use search below.</p> }
          </div>
          <h2 class="sub">Search all channels</h2>
          <input placeholder="Search by name or category" (input)="query.set($any($event.target).value)">
          <div class="list">
            @for (c of searchResults(); track c.key) {
              <label class="item plain">
                <input type="checkbox" [checked]="lineup.keys().has(c.key)" (change)="lineup.toggle(c)">
                <sw-logo [src]="c.logo" [name]="c.name" />
                <span class="name">{{ c.name }}<small>{{ c.category }}</small></span>
              </label>
            }
          </div>
        </section>
      }

      <!-- 4. Lineup -->
      <section class="panel" id="lineup">
        <h2>4 · Storm lineup <small class="muted">({{ lineup.channels().length }})</small></h2>
        @for (c of lineup.channels(); track c.key) {
          <div class="lrow">
            <span class="num">{{ $index + 1 }}</span>
            <input class="lname" [value]="c.name" (change)="lineup.rename(c.key, $any($event.target).value)">
            <button aria-label="Move up" [disabled]="$first" (click)="lineup.move(c.key, -1)">↑</button>
            <button aria-label="Move down" [disabled]="$last" (click)="lineup.move(c.key, 1)">↓</button>
            <button title="Default channel for warnings" [class.on]="lineup.defaultChannel()?.key === c.key"
              (click)="lineup.setDefault(c.key)">★</button>
            <a [routerLink]="['/watch', c.key]">Test</a>
            <button aria-label="Remove" (click)="lineup.remove(c.key)">✕</button>
          </div>
        } @empty {
          <p class="muted">Empty. Connect a source and pick channels above, or import a lineup file.</p>
        }
        <div class="row">
          <button [disabled]="!lineup.channels().length" (click)="exportLineup()">Export</button>
          <label class="btn">Import<input type="file" accept="application/json" hidden (change)="importLineup($event)"></label>
          @if (importMsg()) { <span class="muted">{{ importMsg() }}</span> }
        </div>
        <p class="muted small">Exports include your provider login so another device (TV, phone) can import it. Keep the file private.</p>
      </section>

      <!-- 5. Share -->
      <section class="panel" id="share">
        <h2>5 · Share / TV link</h2>
        <p class="muted">One link that sets up another device (TV, signage player such as Screenly, phone) with this
          location and your dashboards. The setup lives after the <code>#</code> in the URL, so it is never sent to
          the web server, but anyone who has the link can read it.</p>
        <div class="form">
          <label class="check">Open on
            <select (change)="shareBoard.set($any($event.target).value)">
              @for (b of boards.boards(); track b.id) { <option [value]="b.id" [selected]="b.id === shareBoard()">{{ b.name }}</option> }
            </select>
          </label>
          <label class="check"><input type="checkbox" [checked]="shareKiosk()" (change)="shareKiosk.set(!shareKiosk())">
            Kiosk mode (no menus, for TVs)</label>
          <label class="check"><input type="checkbox" [checked]="shareIptv()" [disabled]="!lineup.source()"
            (change)="shareIptv.set(!shareIptv())"> Include IPTV login and channel lineup</label>
        </div>
        @if (shareIptv() && !shareUrl()) {
          <p class="warn">⚠ The link will contain your IPTV username and password.</p>
        }
        <div class="row">
          <button [disabled]="!settings.location()" (click)="makeShare()">Create link</button>
          @if (shareUrl()) {
            <button (click)="copyShare()">{{ copied() ? 'Copied ✓' : 'Copy' }}</button>
            <span class="muted small">{{ shareUrl().length | number }} characters</span>
          }
        </div>
        @if (shareUrl() && shareHasLogin()) {
          <p class="warn">⚠ This link contains your IPTV username and password. Only send it to devices you own,
            and avoid pasting it anywhere that is logged or shared.</p>
        }
        @if (shareUrl()) {
          <textarea class="share" readonly rows="3" aria-label="Share link" [value]="shareUrl()"></textarea>
        }
        @if (shareError()) { <p class="err">{{ shareError() }}</p> }
      </section>
    </div>
  `,
  styles: `
    .wrap { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
    .row, .form { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
    .row input, .form input { flex: 1 1 200px; }
    .pick { display: block; margin: 4px 0; text-align: left; }
    .check { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .check input { width: auto; flex: none; }
    .ok { color: var(--green); } .err { color: var(--red); }
    .list { max-height: 420px; overflow: auto; margin: 8px 0; }
    .item { display: grid; grid-template-columns: auto 32px minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: center;
      padding: 6px; border-radius: 4px; cursor: pointer; }
    .item:hover { background: #21262d; }
    .item input { width: auto; }
    .item.plain { grid-template-columns: auto 32px minmax(0, 1fr); }
    .name { overflow-wrap: anywhere; }
    .name small { display: block; color: var(--muted); font-size: 11px; }
    .why { color: var(--yellow); font-size: 12px; }
    .sub { margin-top: 16px; }
    .lrow { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
    .num { width: 22px; color: var(--muted); text-align: right; }
    .lname { flex: 1; }
    .on { color: var(--yellow); border-color: var(--yellow); }
    .small { font-size: 12px; }
    .warn { color: var(--yellow); }
    .share { width: 100%; font: 12px ui-monospace, Consolas, monospace; background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 6px; padding: 6px; word-break: break-all; }
    @media (max-width: 640px) { .item { grid-template-columns: auto 32px minmax(0, 1fr); } .why { grid-column: 3; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Setup {
  protected readonly settings = inject(SettingsStore);
  protected readonly lineup = inject(LineupStore);
  private readonly nws = inject(NwsService);

  protected readonly geoResults = signal<GeoResult[]>([]);
  protected readonly locError = signal<string | null>(null);
  protected readonly kindSel = linkedSignal<Source['kind']>(() => this.lineup.source()?.kind ?? 'xtream');
  protected readonly account = signal<XtreamAccount | null>(null);
  protected readonly sourceError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  protected readonly importMsg = signal('');
  protected readonly boards = inject(BoardsStore);
  private readonly share = inject(ShareService);
  protected readonly shareBoard = linkedSignal(() => this.boards.first().id);
  protected readonly shareKiosk = signal(true);
  protected readonly shareIptv = signal(false);
  protected readonly shareUrl = signal('');
  protected readonly shareError = signal<string | null>(null);
  protected readonly copied = signal(false);
  /** Whether the *generated* link carries credentials (not just the current checkbox). */
  protected readonly shareHasLogin = signal(false);
  private shareSeq = 0;

  protected readonly xt = computed(() => { const s = this.lineup.source(); return s?.kind === 'xtream' ? s : null; });
  protected readonly m3uUrl = computed(() => { const s = this.lineup.source(); return s?.kind === 'm3u' ? s.url : ''; });

  protected readonly suggestions = computed(() => {
    const loc = this.settings.location();
    return suggest(this.lineup.catalog(), { city: loc?.city ?? '', state: loc?.state ?? '', country: 'US' });
  });

  protected readonly searchResults = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2) {return [];}
    return this.lineup.catalog()
      .filter(c => c.name.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q))
      .slice(0, 200);
  });

  constructor() {
    // A generated link is stale (and may hold credentials) as soon as any option changes.
    effect(() => {
      this.shareIptv();
      this.shareKiosk();
      this.shareBoard();
      untracked(() => { this.shareSeq++; this.shareUrl.set(''); this.shareHasLogin.set(false); this.copied.set(false); });
    });

    // Saved source (hydrates async): reload the catalog so suggestions/search are ready without re-entering credentials.
    effect(() => {
      if (!this.lineup.source()) {return;}
      untracked(() => {
        if (!this.lineup.catalog().length && !this.lineup.catalogLoading()) {this.lineup.loadCatalog();}
      });
    });
  }

  protected async search(q: string): Promise<void> {
    this.locError.set(null);
    if (!q.trim()) {return;}
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=8&countryCode=US`);
      const d = await r.json();
      this.geoResults.set(d.results ?? []);
      if (!d.results?.length) {this.locError.set('No matches.');}
    } catch {
      this.locError.set('Location search failed.');
    }
  }

  protected useGps(): void {
    this.locError.set(null);
    navigator.geolocation?.getCurrentPosition(
      async p => this.pick(p.coords.latitude, p.coords.longitude),
      e => this.locError.set(`Location unavailable: ${  e.message}`),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  protected async pick(lat: number, lon: number): Promise<void> {
    try {
      const p = await this.nws.point(lat, lon);
      this.settings.location.set({ ...p, lat, lon, label: `${p.city}, ${p.state}` });
      this.geoResults.set([]);
    } catch {
      this.locError.set('NWS has no data for that point (US locations only).');
    }
  }

  protected async connectXtream(server: string, username: string, password: string): Promise<void> {
    this.busy.set(true);
    this.sourceError.set(null);
    this.account.set(null);
    try {
      const probe = { kind: 'xtream' as const, server, username, password, format: 'ts' as const };
      const acct = await xtreamLogin(probe);
      this.account.set(acct);
      this.lineup.source.set({ ...probe, format: acct.formats.includes('m3u8') ? 'm3u8' : 'ts' });
      await this.lineup.loadCatalog();
    } catch (e) {
      this.sourceError.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async connectM3u(url: string): Promise<void> {
    this.busy.set(true);
    this.sourceError.set(null);
    this.lineup.source.set({ kind: 'm3u', url });
    await this.lineup.loadCatalog();
    this.busy.set(false);
  }

  protected async makeShare(): Promise<void> {
    this.shareError.set(null);
    this.copied.set(false);
    try {
      const includeIptv = this.shareIptv() && Boolean(this.lineup.source());
      const seq = ++this.shareSeq;
      const cfg = await this.share.create({ includeIptv });
      // Options changed while compressing: this link no longer matches them.
      if (seq !== this.shareSeq) {return;}
      this.shareHasLogin.set(includeIptv);
      const q = new URLSearchParams({ cfg });
      if (this.shareKiosk()) {q.set('kiosk', '1');}
      const base = location.href.split('#')[0];
      this.shareUrl.set(`${base}#/d/${encodeURIComponent(this.shareBoard())}?${q}`);
    } catch (e) {
      this.shareError.set((e as Error).message);
    }
  }

  protected async copyShare(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.copied.set(true);
    } catch {
      this.shareError.set('Copy failed: select the link and copy it manually.');
    }
  }

  protected exportLineup(): void {
    const blob = new Blob([this.lineup.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stormwatch-lineup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  protected async importLineup(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {return;}
    try {
      this.lineup.importJson(await file.text());
      this.importMsg.set(`Imported ${this.lineup.channels().length} channels.`);
    } catch (err) {
      this.importMsg.set((err as Error).message);
    }
  }
}
