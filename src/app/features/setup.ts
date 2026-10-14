import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
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

/** Shortest channel-search query that returns results. */
const MIN_QUERY_LENGTH = 2;
const MAX_SEARCH_RESULTS = 200;

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
  templateUrl: './setup.html',
  styleUrl: './setup.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Setup {
  protected readonly settings = inject(SettingsStore);
  protected readonly lineup = inject(LineupStore);
  private readonly nws = inject(NwsService);
  protected readonly boards = inject(BoardsStore);
  private readonly share = inject(ShareService);

  protected readonly geoResults = signal<GeoResult[]>([]);
  protected readonly locError = signal<string | null>(null);
  protected readonly kindSel = linkedSignal<Source['kind']>(
    () => this.lineup.source()?.kind ?? 'xtream',
  );
  protected readonly account = signal<XtreamAccount | null>(null);
  protected readonly sourceError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  protected readonly importMsg = signal('');
  protected readonly shareBoard = linkedSignal(() => this.boards.first().id);
  protected readonly shareKiosk = signal(true);
  protected readonly shareIptv = signal(false);
  protected readonly shareUrl = signal('');
  protected readonly shareError = signal<string | null>(null);
  protected readonly copied = signal(false);
  /** Whether the *generated* link carries credentials (not just the current checkbox). */
  protected readonly shareHasLogin = signal(false);
  private shareSeq = 0;

  protected readonly xt = computed(() => {
    const s = this.lineup.source();
    return s?.kind === 'xtream' ? s : null;
  });
  protected readonly m3uUrl = computed(() => {
    const s = this.lineup.source();
    return s?.kind === 'm3u' ? s.url : '';
  });

  protected readonly suggestions = computed(() => {
    const loc = this.settings.location();
    return suggest(this.lineup.catalog(), {
      city: loc?.city ?? '',
      state: loc?.state ?? '',
      country: 'US',
    });
  });

  protected readonly searchResults = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < MIN_QUERY_LENGTH) {
      return [];
    }
    return this.lineup
      .catalog()
      .filter((c) => c.name.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q))
      .slice(0, MAX_SEARCH_RESULTS);
  });

  constructor() {
    // A generated link is stale (and may hold credentials) as soon as any option changes.
    effect(() => {
      this.shareIptv();
      this.shareKiosk();
      this.shareBoard();
      untracked(() => {
        this.shareSeq++;
        this.shareUrl.set('');
        this.shareHasLogin.set(false);
        this.copied.set(false);
      });
    });

    // Saved source (hydrates async): reload the catalog so suggestions/search are ready without re-entering credentials.
    effect(() => {
      if (!this.lineup.source()) {
        return;
      }
      untracked(() => {
        if (!this.lineup.catalog().length && !this.lineup.catalogLoading()) {
          this.lineup.loadCatalog().catch((err: unknown) => {
            console.error('Could not load the channel list', err);
          });
        }
      });
    });
  }

  protected pickKind(value: string): void {
    this.kindSel.set(value === 'm3u' ? 'm3u' : 'xtream');
  }

  protected async search(q: string): Promise<void> {
    this.locError.set(null);
    if (!q.trim()) {
      return;
    }
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=8&countryCode=US`,
      );
      const d = (await r.json()) as { results?: GeoResult[] };
      this.geoResults.set(d.results ?? []);
      if (!d.results?.length) {
        this.locError.set('No matches.');
      }
    } catch {
      this.locError.set('Location search failed.');
    }
  }

  protected useGps(): void {
    this.locError.set(null);
    // Some embedded TV/signage browsers do not provide geolocation.
    if (!('geolocation' in navigator)) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        this.pick(p.coords.latitude, p.coords.longitude).catch((err: unknown) => {
          console.error('Could not use this location', err);
        });
      },
      (e) => this.locError.set(`Location unavailable: ${e.message}`),
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
      if (seq !== this.shareSeq) {
        return;
      }
      this.shareHasLogin.set(includeIptv);
      const q = new URLSearchParams({ cfg });
      if (this.shareKiosk()) {
        q.set('kiosk', '1');
      }
      const base = location.href.split('#')[0] ?? '';
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
    if (!file) {
      return;
    }
    try {
      this.lineup.importJson(await file.text());
      this.importMsg.set(`Imported ${this.lineup.channels().length} channels.`);
    } catch (err) {
      this.importMsg.set((err as Error).message);
    }
  }
}
