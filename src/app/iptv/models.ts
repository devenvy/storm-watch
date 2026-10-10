export interface Channel {
  /** Stable identity used in routes and the saved lineup. */
  key: string;
  name: string;
  url: string;
  logo?: string;
  category?: string;
  epgId?: string;
  /** Xtream stream id, enables now-playing lookups. */
  streamId?: number;
}

export interface XtreamSource {
  kind: 'xtream';
  server: string;
  username: string;
  password: string;
  format: 'm3u8' | 'ts';
}

export interface M3uSource {
  kind: 'm3u';
  url: string;
}

export type Source = XtreamSource | M3uSource;

export interface Lineup {
  version: 1;
  channels: Channel[];
  defaultKey: string | null;
}
