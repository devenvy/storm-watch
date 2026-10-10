import { num, str, webUrl } from '../core/guards';
import { Channel, Lineup, Source } from './models';

/** Validation for IPTV data from untrusted input (imported files, share links, storage). */

export function sanitizeSource(v: unknown): Source | null {
  const s = v as Partial<Source> | null;
  if (s?.kind === 'xtream') {
    if (!webUrl(s.server) || !str(s.username) || !str(s.password)) return null;
    return { kind: 'xtream', server: s.server, username: s.username, password: s.password, format: s.format === 'm3u8' ? 'm3u8' : 'ts' };
  }
  if (s?.kind === 'm3u' && webUrl(s.url)) return { kind: 'm3u', url: s.url };
  return null;
}

export function sanitizeLineup(v: unknown): Lineup | null {
  const l = v as Partial<Lineup> | null;
  if (!l || !Array.isArray(l.channels)) return null;
  const channels: Channel[] = l.channels.slice(0, 200).flatMap((c: Partial<Channel>) => {
    if (!c || !str(c.key, 100) || !str(c.name, 200) || !webUrl(c.url)) return [];
    return [{
      key: c.key, name: c.name, url: c.url,
      ...(webUrl(c.logo) ? { logo: c.logo } : {}),
      ...(str(c.category) ? { category: c.category } : {}),
      ...(str(c.epgId) ? { epgId: c.epgId } : {}),
      ...(num(c.streamId, 0, Number.MAX_SAFE_INTEGER) ? { streamId: c.streamId } : {}),
    }];
  });
  const defaultKey = str(l.defaultKey, 100) && channels.some(c => c.key === l.defaultKey) ? l.defaultKey : null;
  return { version: 1, channels, defaultKey };
}

