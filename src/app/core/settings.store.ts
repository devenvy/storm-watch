import { inject, Injectable, signal } from '@angular/core';

import { num, str } from './guards';
import { Persist } from './storage/persist';

import type { PointInfo } from './nws.service';

export interface HomeLocation extends PointInfo {
  lat: number;
  lon: number;
  label: string;
}

const MAX_LAT = 90;
const MAX_LON = 180;
/** Upper bound for the office / radar-station codes before their exact pattern check. */
const MAX_CODE_LENGTH = 4;
const MAX_STATIONS_URL_LENGTH = 300;
const MAX_LABEL_LENGTH = 80;
const MAX_STATE_LENGTH = 40;
const MAX_PWS_ID_LENGTH = 64;
/** Decimals shown in a coordinate-only label. */
const LABEL_COORD_DECIMALS = 2;

export function sanitizeLocation(v: unknown): HomeLocation | null {
  const l = v as Partial<HomeLocation> | null;
  if (!l || !num(l.lat, -MAX_LAT, MAX_LAT) || !num(l.lon, -MAX_LON, MAX_LON)) {
    return null;
  }
  if (
    !str(l.office, MAX_CODE_LENGTH) ||
    !/^[A-Z]{3}$/.test(l.office) ||
    !str(l.radarStation, MAX_CODE_LENGTH) ||
    !/^[A-Z]{4}$/.test(l.radarStation)
  ) {
    return null;
  }
  if (
    !str(l.stationsUrl, MAX_STATIONS_URL_LENGTH) ||
    !l.stationsUrl.startsWith('https://api.weather.gov/')
  ) {
    return null;
  }
  return {
    lat: l.lat,
    lon: l.lon,
    office: l.office,
    radarStation: l.radarStation,
    stationsUrl: l.stationsUrl,
    label: str(l.label, MAX_LABEL_LENGTH)
      ? l.label
      : `${l.lat.toFixed(LABEL_COORD_DECIMALS)}, ${l.lon.toFixed(LABEL_COORD_DECIMALS)}`,
    city: str(l.city, MAX_LABEL_LENGTH) ? l.city : '',
    state: str(l.state, MAX_STATE_LENGTH) ? l.state : '',
  };
}

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly persist = inject(Persist);
  readonly location = this.persist.signal<HomeLocation | null>(
    'sw.location',
    null,
    sanitizeLocation,
  );
  /** Jump to the default lineup channel when a danger-level alert starts. */
  readonly autoTune = this.persist.signal('sw.autoTune', true, (v) =>
    typeof v === 'boolean' ? v : null,
  );
  /** Ambient Weather Network station id to prefer over the nearest one (null = nearest active). */
  readonly pws = this.persist.signal<string | null>('sw.pws', null, (v) =>
    str(v, MAX_PWS_ID_LENGTH) && /^[\w-]+$/.test(v) ? v : null,
  );
  /** Audio needs a user gesture each session, so this is not persisted. */
  readonly soundArmed = signal(false);
}
