import type { Channel, M3uSource, XtreamSource } from './models';

export class SourceError extends Error {}

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

export async function xtreamLogin(s: XtreamSource): Promise<XtreamAccount> {
  const r = await diagnosedFetch(apiUrl(s));
  if (!r.ok) {
    throw new SourceError(`Login failed: HTTP ${r.status}`);
  }
  const d = await r.json();
  const u = d.user_info;
  if (!u || u.auth === 0) {
    throw new SourceError('Login rejected: check username and password.');
  }
  return {
    status: u.status,
    maxConnections: +u.max_connections,
    activeConnections: +u.active_cons,
    formats: u.allowed_output_formats ?? ['ts'],
    expires: u.exp_date ? new Date(+u.exp_date * 1000) : null,
  };
}

interface XtreamCategory {
  category_id: string | number;
  category_name: string;
}
interface XtreamStream {
  stream_id: number;
  name?: string;
  stream_icon?: string;
  category_id?: string | number;
  epg_channel_id?: string;
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
    logo: st.stream_icon || undefined,
    category: catName.get(String(st.category_id)),
    epgId: st.epg_channel_id || undefined,
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

export async function xtreamNowPlaying(
  s: XtreamSource,
  streamId: number,
): Promise<NowPlaying | null> {
  const r = await fetch(apiUrl(s, 'get_short_epg', `&stream_id=${streamId}&limit=1`));
  const d = await r.json();
  const e = d.epg_listings?.[0];
  if (!e) {
    return null;
  }
  return {
    title: b64utf8(e.title ?? ''),
    description: b64utf8(e.description ?? ''),
    start: new Date(+e.start_timestamp * 1000),
    end: new Date(+e.stop_timestamp * 1000),
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
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i];
    if (!info.startsWith('#EXTINF')) {
      continue;
    }
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].startsWith('#'))) {
      j++;
    }
    const url = lines[j]?.trim();
    if (!url) {
      continue;
    }
    const attr = (name: string) => info.match(new RegExp(`${name}="([^"]*)"`))?.[1] || undefined;
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
  return out;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(36);
}
