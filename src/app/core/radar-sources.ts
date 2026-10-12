import { Injectable } from '@angular/core';

import { FETCH_TIMEOUT_MS } from './nws.service';

const IEM = 'https://mesonet.agron.iastate.edu';
const IEM_TILES = `${IEM}/cache/tile.py/1.0.0`;

export type FrameKind = 'past' | 'forecast';

export interface RadarFrame {
  time: Date;
  url: string;
  kind: FrameKind;
}

export interface RadarSet {
  frames: RadarFrame[];
  /** Index to show first: the newest observed frame. */
  startIndex: number;
  /** Max zoom the tile server renders; Leaflet upscales beyond it. */
  maxNativeZoom?: number;
  note?: string;
}

export type RadarSourceId =
  'blend' | 'mosaic' | 'hrrr' | 'site-ref' | 'site-vel' | 'rainviewer' | 'site-gif';

export interface RadarSourceInfo {
  id: RadarSourceId;
  label: string;
  /** 'image' sources render a ready-made loop instead of map tiles. */
  type: 'tiles' | 'image';
}

export const RADAR_SOURCES: RadarSourceInfo[] = [
  { id: 'blend', label: 'Past + forecast', type: 'tiles' },
  { id: 'mosaic', label: 'Radar mosaic (50 min)', type: 'tiles' },
  { id: 'hrrr', label: 'Forecast only (HRRR, 6 h)', type: 'tiles' },
  { id: 'site-ref', label: 'Local radar · reflectivity', type: 'tiles' },
  { id: 'site-vel', label: 'Local radar · velocity (rotation)', type: 'tiles' },
  { id: 'rainviewer', label: 'RainViewer (2 h)', type: 'tiles' },
  { id: 'site-gif', label: 'Local radar · NWS loop image', type: 'image' },
];

/** The slices of the upstream metadata responses this file reads. */
interface MosaicMeta {
  meta: { valid: string };
}
interface HrrrMeta {
  model_init_utc: string;
}
interface ScanList {
  scans: { ts: string }[];
}
interface RainViewerMaps {
  host: string;
  radar: { past: { time: number; path: string }[] };
}

const MIN = 60_000;
const MOSAIC_OFFSETS = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];
const FORECAST_HOURS = 6;

function ymdhm(d: Date): string {
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) {
    throw new Error(`${r.status} ${url}`);
  }
  return r.json() as Promise<T>;
}

/** Builds time-stamped frame lists for each radar source. All sources are keyless and CORS-enabled. */
@Injectable({ providedIn: 'root' })
export class RadarSources {
  async load(id: RadarSourceId, radarStation: string): Promise<RadarSet> {
    switch (id) {
      case 'mosaic':
        return this.mosaic();
      case 'hrrr':
        return this.hrrr(null);
      case 'blend':
        return this.blend();
      case 'site-ref':
        return this.site(radarStation, 'N0B');
      case 'site-vel':
        return this.site(radarStation, 'N0S');
      case 'rainviewer':
        return this.rainviewer();
      case 'site-gif':
        return { frames: [], startIndex: 0 };
    }
  }

  /** NEXRAD national mosaic; IEM keeps the latest plus 5-minute steps back 50 minutes. */
  private async mosaic(): Promise<RadarSet> {
    const meta = await json<MosaicMeta>(`${IEM}/data/gis/images/4326/USCOMP/n0q_0.json`);
    const latest = new Date(meta.meta.valid);
    const bust = latest.getTime();
    const frames = MOSAIC_OFFSETS.map((o) => ({
      time: new Date(latest.getTime() - o * MIN),
      url: `${IEM_TILES}/nexrad-n0q-900913${o ? `-m${String(o).padStart(2, '0')}m` : ''}/{z}/{x}/{y}.png?_=${bust}`,
      kind: 'past' as const,
    }));
    return { frames, startIndex: frames.length - 1 };
  }

  /**
   * HRRR simulated reflectivity, 15-minute steps from the latest model run.
   * `after`: only include frames valid after this time (used to continue past radar).
   */
  private async hrrr(after: Date | null): Promise<RadarSet> {
    const meta = await json<HrrrMeta>(`${IEM}/data/gis/images/4326/hrrr/refd_0000.json`);
    const init = new Date(meta.model_init_utc);
    const now = Date.now();
    const end = now + FORECAST_HOURS * 60 * MIN;
    const from = after ? after.getTime() : now - 15 * MIN;
    const frames: RadarFrame[] = [];
    for (let m = 0; m <= 18 * 60; m += 15) {
      const t = init.getTime() + m * MIN;
      if (t <= from || t > end) {
        continue;
      }
      frames.push({
        time: new Date(t),
        url: `${IEM_TILES}/hrrr::REFD-F${String(m).padStart(4, '0')}-0/{z}/{x}/{y}.png?_=${init.getTime()}`,
        kind: 'forecast',
      });
    }
    return {
      frames,
      startIndex: 0,
      note: `HRRR model run ${init.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: simulated, not observed`,
    };
  }

  /** Observed mosaic continuing into the HRRR forecast on one timeline. */
  private async blend(): Promise<RadarSet> {
    const past = await this.mosaic();
    const last = past.frames[past.frames.length - 1].time;
    const future = await this.hrrr(last).catch(() => ({
      frames: [] as RadarFrame[],
      note: 'Forecast unavailable',
    }));
    return {
      frames: [...past.frames, ...future.frames],
      startIndex: past.startIndex,
      note: future.note,
    };
  }

  /** Single-site super-res products with real scan times (~4-6 min apart), last hour. */
  private async site(station: string, product: 'N0B' | 'N0S'): Promise<RadarSet> {
    const id = station.length === 4 ? station.slice(1) : station;
    const end = new Date();
    const start = new Date(end.getTime() - 60 * MIN);
    const iso = (d: Date) => `${d.toISOString().slice(0, 17)}00Z`;
    const d = await json<ScanList>(
      `${IEM}/json/radar.py?operation=list&radar=${id}&product=${product}&start=${iso(start)}&end=${iso(end)}`,
    );
    const frames = d.scans.map((s) => {
      const t = new Date(s.ts);
      return {
        time: t,
        url: `${IEM_TILES}/ridge::${id}-${product}-${ymdhm(t)}/{z}/{x}/{y}.png`,
        kind: 'past' as const,
      };
    });
    if (!frames.length) {
      throw new Error(`No recent ${product} scans from ${station}`);
    }
    return {
      frames,
      startIndex: frames.length - 1,
      note:
        product === 'N0S'
          ? 'Storm-relative velocity: tight red/green couplets indicate rotation'
          : undefined,
    };
  }

  /** RainViewer composite: 2 h of history; tiles only render to zoom 7. */
  private async rainviewer(): Promise<RadarSet> {
    const d = await json<RainViewerMaps>('https://api.rainviewer.com/public/weather-maps.json');
    const frames = d.radar.past.map((f) => ({
      time: new Date(f.time * 1000),
      url: `${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
      kind: 'past' as const,
    }));
    return { frames, startIndex: frames.length - 1, maxNativeZoom: 7 };
  }
}
