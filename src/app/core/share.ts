import { inject, Injectable } from '@angular/core';
import { Board, BoardsStore, sanitizeBoards } from './boards.store';
import { HomeLocation, sanitizeLocation, SettingsStore } from './settings.store';
import { Persist } from './storage/persist';
import { LineupStore } from '../iptv/lineup.store';
import { Lineup, Source } from '../iptv/models';
import { sanitizeLineup, sanitizeSource } from '../iptv/validate';

/**
 * Share links carry a device setup in the URL *fragment* (everything after #), which
 * browsers never send to a server. Format: `z` + base64url(deflate-raw(JSON)), or
 * `j` + base64url(JSON) where CompressionStream is unavailable.
 */
export interface SharePayload {
  app: 'stormwatch';
  v: 1;
  location?: HomeLocation;
  boards?: Board[];
  autoTune?: boolean;
  /** Only present when the sharer opted in: contains IPTV login details. */
  source?: Source;
  lineup?: Lineup;
}

export interface ShareOptions {
  includeIptv: boolean;
}

const MAX_ENCODED = 64_000;
const MAX_JSON = 512_000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

/** Runs bytes through a (de)compression stream, aborting as soon as output exceeds `limit`. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Not awaited: the readable side must be drained concurrently or large inputs stall.
  void writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      await writer.abort().catch(() => undefined);
      throw new Error('Share link is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export async function encodePayload(p: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(p));
  if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodePayload(s: string): Promise<unknown> {
  if (s.length > MAX_ENCODED) throw new Error('Share link is too large.');
  const kind = s[0];
  let bytes = fromBase64Url(s.slice(1));
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed share links.');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON);
  } else if (kind !== 'j') {
    throw new Error('Unrecognized share link.');
  }
  if (bytes.length > MAX_JSON) throw new Error('Share link is too large.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly settings = inject(SettingsStore);
  private readonly boards = inject(BoardsStore);
  private readonly lineup = inject(LineupStore);
  private readonly persist = inject(Persist);
  /** The last link applied on this device, so a TV reloading the same link applies it silently. */
  private readonly lastApplied = this.persist.signal<string | null>('sw.lastShare', null, v => (typeof v === 'string' ? v : null));

  async create(opts: ShareOptions): Promise<string> {
    const p: SharePayload = {
      app: 'stormwatch', v: 1,
      location: this.settings.location() ?? undefined,
      boards: this.boards.boards(),
      autoTune: this.settings.autoTune(),
    };
    // Channel URLs embed IPTV credentials, so the lineup only travels with the source.
    if (opts.includeIptv) {
      p.source = this.lineup.source() ?? undefined;
      p.lineup = this.lineup.lineup();
    }
    return encodePayload(p);
  }

  /** Applies a share link. Asks first if it would overwrite a different existing setup. */
  async apply(encoded: string): Promise<boolean> {
    await this.persist.ready();
    const raw = (await decodePayload(encoded)) as Partial<SharePayload>;
    if (raw?.app !== 'stormwatch' || raw.v !== 1) throw new Error('Not a Storm Watch share link.');

    const location = sanitizeLocation(raw.location);
    const boards = sanitizeBoards(raw.boards);
    const source = sanitizeSource(raw.source);
    const lineup = source ? sanitizeLineup(raw.lineup) : null;

    const hasSetup = !!this.settings.location() || !!this.lineup.source();
    if (hasSetup && this.lastApplied() !== encoded) {
      const parts = [location && 'location', boards && 'dashboards', source && 'IPTV login + channels'].filter(Boolean);
      if (!confirm(`Apply this shared Storm Watch setup? It replaces your ${parts.join(', ')} on this device.`)) return false;
    }

    if (location) this.settings.location.set(location);
    if (boards) this.boards.boards.set(boards);
    if (typeof raw.autoTune === 'boolean') this.settings.autoTune.set(raw.autoTune);
    if (source) {
      this.lineup.source.set(source);
      if (lineup) this.lineup.lineup.set(lineup);
      // Re-poll the provider so channel URLs and logos are current.
      void this.lineup.loadCatalog();
    }
    this.lastApplied.set(encoded);
    return true;
  }
}
