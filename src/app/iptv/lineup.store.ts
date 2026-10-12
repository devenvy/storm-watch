import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';

import { m3uChannels, xtreamChannels } from './sources';
import { sanitizeLineup, sanitizeSource } from './validate';
import { Persist } from '../core/storage/persist';

import type { Channel, Lineup, Source } from './models';

const JSON_INDENT = 2;

/** Shape of an exported lineup file; every field is untrusted until sanitized. */
interface ExportFile {
  app?: unknown;
  source?: unknown;
  lineup?: unknown;
}

/**
 * The saved source and the user's "storm lineup": a small, pre-curated channel list
 * kept on-device so it opens instantly with no login or catalog download.
 */
function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

@Injectable({ providedIn: 'root' })
export class LineupStore {
  private readonly persist = inject(Persist);
  readonly source = this.persist.signal<Source | null>('sw.source', null, sanitizeSource);
  readonly lineup = this.persist.signal<Lineup>(
    'sw.lineup',
    { version: 1, channels: [], defaultKey: null },
    sanitizeLineup,
  );

  /** Full provider catalog; in memory only (can be tens of thousands of entries). */
  readonly catalog = signal<Channel[]>([]);
  readonly catalogLoading = signal(false);
  readonly catalogError = signal<string | null>(null);
  private catalogSeq = 0;
  /** The source the current catalog (or the load in flight) belongs to. */
  private catalogFor: Source | null = null;

  constructor() {
    // A different provider means the in-memory catalog (and any load in flight) is stale.
    effect(() => {
      const src = this.source();
      untracked(() => {
        if (src === this.catalogFor) {
          return;
        }
        this.catalogFor = null;
        this.catalogSeq++;
        this.catalog.set([]);
        this.catalogLoading.set(false);
        this.catalogError.set(null);
      });
    });
  }

  readonly channels = computed(() => this.lineup().channels);
  readonly keys = computed(() => new Set(this.channels().map((c) => c.key)));
  readonly defaultChannel = computed(() => {
    const l = this.lineup();
    return l.channels.find((c) => c.key === l.defaultKey) ?? l.channels[0] ?? null;
  });

  async loadCatalog(): Promise<void> {
    const src = this.source();
    if (!src) {
      return;
    }
    const seq = ++this.catalogSeq;
    this.catalogFor = src;
    this.catalogLoading.set(true);
    this.catalogError.set(null);
    try {
      const catalog = src.kind === 'xtream' ? await xtreamChannels(src) : await m3uChannels(src);
      // A newer load (or a source change) superseded this one.
      if (seq !== this.catalogSeq || this.source() !== src) {
        return;
      }
      this.catalog.set(catalog);
      this.refreshLineup(catalog);
    } catch (e) {
      if (seq === this.catalogSeq) {
        this.catalogError.set((e as Error).message);
      }
    } finally {
      if (seq === this.catalogSeq) {
        this.catalogLoading.set(false);
      }
    }
  }

  /**
   * Pick up changed stream URLs/logos for saved channels (keeps the user's names).
   * Only within the same server: Xtream stream ids are per-provider, so the same key on a
   * different provider is a different channel.
   */
  private refreshLineup(catalog: Channel[]): void {
    const byKey = new Map(catalog.map((c) => [c.key, c]));
    this.lineup.update((l) => {
      const channels = l.channels.map((c) => {
        const fresh = byKey.get(c.key);
        if (
          !fresh ||
          (fresh.url === c.url && fresh.logo === c.logo) ||
          origin(fresh.url) !== origin(c.url)
        ) {
          return c;
        }
        return { ...c, url: fresh.url, logo: fresh.logo };
      });
      const changed = channels.some((c, i) => c !== l.channels[i]);
      return changed ? { ...l, channels } : l;
    });
  }

  byKey(key: string): Channel | undefined {
    return this.channels().find((c) => c.key === key) ?? this.catalog().find((c) => c.key === key);
  }

  add(ch: Channel): void {
    if (this.keys().has(ch.key)) {
      return;
    }
    this.lineup.update((l) => ({ ...l, channels: [...l.channels, ch] }));
  }

  remove(key: string): void {
    this.lineup.update((l) => ({
      ...l,
      channels: l.channels.filter((c) => c.key !== key),
      defaultKey: l.defaultKey === key ? null : l.defaultKey,
    }));
  }

  toggle(ch: Channel): void {
    if (this.keys().has(ch.key)) {
      this.remove(ch.key);
    } else {
      this.add(ch);
    }
  }

  move(key: string, delta: number): void {
    this.lineup.update((l) => {
      const list = [...l.channels];
      const i = list.findIndex((c) => c.key === key);
      const j = i + delta;
      const a = list[i];
      const b = list[j];
      // Either end out of range (including an unknown key) leaves the order unchanged.
      if (!a || !b) {
        return l;
      }
      list[i] = b;
      list[j] = a;
      return { ...l, channels: list };
    });
  }

  rename(key: string, name: string): void {
    this.lineup.update((l) => ({
      ...l,
      channels: l.channels.map((c) => (c.key === key ? { ...c, name } : c)),
    }));
  }

  setDefault(key: string): void {
    this.lineup.update((l) => ({ ...l, defaultKey: key }));
  }

  /** Neighbor in lineup order, wrapping; used for channel up/down. */
  neighbor(key: string, delta: number): Channel | null {
    const list = this.channels();
    if (!list.length) {
      return null;
    }
    const i = list.findIndex((c) => c.key === key);
    return list[((((i < 0 ? 0 : i) + delta) % list.length) + list.length) % list.length] ?? null;
  }

  exportJson(): string {
    return JSON.stringify(
      { app: 'stormwatch', source: this.source(), lineup: this.lineup() },
      null,
      JSON_INDENT,
    );
  }

  importJson(text: string): void {
    const parsed: unknown = JSON.parse(text);
    const d = typeof parsed === 'object' && parsed !== null ? (parsed as ExportFile) : null;
    const lineup = d?.app === 'stormwatch' ? sanitizeLineup(d.lineup) : null;
    if (!d || !lineup) {
      throw new Error('Not a Storm Watch export.');
    }
    this.source.set(sanitizeSource(d.source));
    this.lineup.set(lineup);
  }
}
