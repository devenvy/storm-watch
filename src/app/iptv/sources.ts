import type { Channel, M3uSource, XtreamSource } from './models';

export class SourceError extends Error {}

const MS_PER_SECOND = 1000;
/** FNV-1a 32-bit parameters. */
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const KEY_RADIX = 36;

/** Providers send '' (or nothing) for a missing value; both mean "none". */
function orUndefined(s: string | null | undefined): string | undefined {
  if (!s) {
    return undefined;
  }
  return s;
}

/**
 * Fetch with a diagnosis of the usual browser failures, since a bare TypeError
 * ("Failed to fetch") tells the user nothing.
 */
export async function diagnosedFetch(url: string): Promise<Response> {
  const target = new URL(url);
  if (location.protocol === 'https:' && target.protocol === 'http:') {
    throw new SourceError(
      'Blocked as mixed content: this page is https but the provider is http. ' +
        'Run Storm Watch over http (self-hosted/local) or use the app/extension.',
    );
  }
  try {
    return await fetch(url);
  } catch {
    try {
      await fetch(url, { mode: 'no-cors' });
      throw new SourceError(
        'Provider is reachable but does not allow browser access (no CORS header).',
      );
    } catch (e) {
      if (e instanceof SourceError) {
        throw e;
      }
      throw new SourceError('Provider unreachable (offline, DNS, blocked port, or wrong URL).');
    }
  }
}

function base(s: XtreamSource): string {
  return s.server.trim().replace(/\/+$/, '');
}

function apiUrl(s: XtreamSource, action?: string, extra = ''): string {
  const q = `username=${encodeURIComponent(s.username)}&password=${encodeURIComponent(s.password)}`;
  return `${base(s)}/player_api.php?${q}${action ? `&action=${action}` : ''}${extra}`;
}

export interface XtreamAccount {
  status: string;
  maxConnections: number;
  activeConnections: number;
  formats: string[];
  expires: Date | null;
}

/** `player_api.php` login response; providers vary, so numbers may arrive as strings. */
interface XtreamUserInfo {
  auth?: number;
  status: string;
  max_connections?: string | number;
  active_cons?: string | number;
  allowed_output_formats?: string[];
  exp_date?: string | number | null;
}
interface XtreamLoginResponse {
  user_info?: XtreamUserInfo | null;
}

export async function xtreamLogin(s: XtreamSource): Promise<XtreamAccount> {
  const r = await diagnosedFetch(apiUrl(s));
  if (!r.ok) {
    throw new SourceError(`Login failed: HTTP ${r.status}`);
  }
  const d = (await r.json()) as XtreamLoginResponse;
  const u = d.user_info;
  if (!u || u.auth === 0) {
    throw new SourceError('Login rejected: check username and password.');
  }
  return {
    status: u.status,
    maxConnections: Number(u.max_connections),
    activeConnections: Number(u.active_cons),
    formats: u.allowed_output_formats ?? ['ts'],
    expires: u.exp_date ? new Date(Number(u.exp_date) * MS_PER_SECOND) : null,
  };
}

interface XtreamCategory {
  category_id: string | number;
  category_name: string;
}
interface XtreamStream {
  stream_id: number;
  name?: string | number | null;
  stream_icon?: string | null;
  category_id?: string | number;
  epg_channel_id?: string | null;
}

export async function xtreamChannels(s: XtreamSource): Promise<Channel[]> {
  const [cats, streams] = await Promise.all([
    diagnosedFetch(apiUrl(s, 'get_live_categories')).then(
      async (r) => r.json() as Promise<XtreamCategory[]>,
    ),
    diagnosedFetch(apiUrl(s, 'get_live_streams')).then(
      async (r) => r.json() as Promise<XtreamStream[]>,
    ),
  ]);
  const catName = new Map<string, string>(
    cats.map((c) => [String(c.category_id), c.category_name]),
  );
  const user = encodeURIComponent(s.username);
  const pass = encodeURIComponent(s.password);
  return streams.map((st) => ({
    key: `x${st.stream_id}`,
    name: String(st.name ?? '').trim(),
    url: `${base(s)}/live/${user}/${pass}/${st.stream_id}.${s.format}`,
    logo: orUndefined(st.stream_icon),
    category: catName.get(String(st.category_id)),
    epgId: orUndefined(st.epg_channel_id),
    streamId: st.stream_id,
  }));
}

function b64utf8(s: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

export interface NowPlaying {
  title: string;
  description: string;
  start: Date;
  end: Date;
}

interface XtreamEpgListing {
  /** Base64-encoded UTF-8. */
  title?: string;
  /** Base64-encoded UTF-8. */
  description?: string;
  start_timestamp: string | number;
  stop_timestamp: string | number;
}
interface XtreamShortEpg {
  epg_listings?: XtreamEpgListing[];
}

export async function xtreamNowPlaying(
  s: XtreamSource,
  streamId: number,
): Promise<NowPlaying | null> {
  const r = await fetch(apiUrl(s, 'get_short_epg', `&stream_id=${streamId}&limit=1`));
  const d = (await r.json()) as XtreamShortEpg;
  const e = d.epg_listings?.[0];
  if (!e) {
    return null;
  }
  return {
    title: b64utf8(e.title ?? ''),
    description: b64utf8(e.description ?? ''),
    start: new Date(Number(e.start_timestamp) * MS_PER_SECOND),
    end: new Date(Number(e.stop_timestamp) * MS_PER_SECOND),
  };
}

export async function m3uChannels(s: M3uSource): Promise<Channel[]> {
  const r = await diagnosedFetch(s.url.trim());
  if (!r.ok) {
    throw new SourceError(`Playlist failed: HTTP ${r.status}`);
  }
  return parseM3u(await r.text());
}

export function parseM3u(text: string): Channel[] {
  const out: Channel[] = [];
  const lines = text.split(/\r?\n/);
  /** Blank lines and other directives between #EXTINF and its URL. */
  const skippable = (line: string | undefined) =>
    line !== undefined && (!line.trim() || line.startsWith('#'));
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i] ?? '';
    if (info.startsWith('#EXTINF')) {
      let j = i + 1;
      while (skippable(lines[j])) {
        j++;
      }
      const url = lines[j]?.trim();
      if (url) {
        const attr = (name: string) =>
          orUndefined(info.match(new RegExp(`${name}="([^"]*)"`))?.[1]);
        const comma = info.indexOf(',', info.lastIndexOf('"') + 1);
        out.push({
          key: `m${hash(url)}`,
          name: (comma >= 0 ? info.slice(comma + 1) : (attr('tvg-name') ?? url)).trim(),
          url,
          logo: attr('tvg-logo'),
          category: attr('group-title'),
          epgId: attr('tvg-id'),
        });
        i = j;
      }
    }
  }
  return out;
}

/** FNV-1a; the result is a persisted channel key, so the algorithm must never change. */
function hash(s: string): string {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    // eslint-disable-next-line no-bitwise -- FNV-1a is defined in terms of XOR
    h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME);
  }
  // eslint-disable-next-line no-bitwise -- reinterpret the signed 32-bit result as unsigned
  return (h >>> 0).toString(KEY_RADIX);
}
