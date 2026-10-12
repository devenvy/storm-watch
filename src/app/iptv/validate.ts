import { num, str, webUrl } from '../core/guards';

import type { Channel, Lineup, Source } from './models';

/** Validation for IPTV data from untrusted input (imported files, share links, storage). */

const MAX_CHANNELS = 200;
const MAX_KEY_LENGTH = 100;
const MAX_NAME_LENGTH = 200;

export function sanitizeSource(v: unknown): Source | null {
  const s = v as Partial<Source> | null;
  if (s?.kind === 'xtream') {
    if (!webUrl(s.server) || !str(s.username) || !str(s.password)) {
      return null;
    }
    return {
      kind: 'xtream',
      server: s.server,
      username: s.username,
      password: s.password,
      format: s.format === 'm3u8' ? 'm3u8' : 'ts',
    };
  }
  if (s?.kind === 'm3u' && webUrl(s.url)) {
    return { kind: 'm3u', url: s.url };
  }
  return null;
}

export function sanitizeLineup(v: unknown): Lineup | null {
  const l = v as Partial<Lineup> | null;
  if (!l || !Array.isArray(l.channels)) {
    return null;
  }
  const channels: Channel[] = l.channels
    .slice(0, MAX_CHANNELS)
    .flatMap((c: Partial<Channel> | null) => {
      if (!c || !str(c.key, MAX_KEY_LENGTH) || !str(c.name, MAX_NAME_LENGTH) || !webUrl(c.url)) {
        return [];
      }
      return [
        {
          key: c.key,
          name: c.name,
          url: c.url,
          ...(webUrl(c.logo) ? { logo: c.logo } : {}),
          ...(str(c.category) ? { category: c.category } : {}),
          ...(str(c.epgId) ? { epgId: c.epgId } : {}),
          ...(num(c.streamId, 0, Number.MAX_SAFE_INTEGER) ? { streamId: c.streamId } : {}),
        },
      ];
    });
  const defaultKey =
    str(l.defaultKey, MAX_KEY_LENGTH) && channels.some((c) => c.key === l.defaultKey)
      ? l.defaultKey
      : null;
  return { version: 1, channels, defaultKey };
}
