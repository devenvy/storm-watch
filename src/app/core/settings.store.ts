import { inject, Injectable, signal } from '@angular/core';
import { Persist } from './storage/persist';
import { PointInfo } from './nws.service';
import { num, str } from './guards';

export interface HomeLocation extends PointInfo {
  lat: number;
  lon: number;
  label: string;
}

export function sanitizeLocation(v: unknown): HomeLocation | null {
  const l = v as Partial<HomeLocation> | null;
  if (!l || !num(l.lat, -90, 90) || !num(l.lon, -180, 180)) return null;
  if (!str(l.office, 4) || !/^[A-Z]{3}$/.test(l.office) || !str(l.radarStation, 4) || !/^[A-Z]{4}$/.test(l.radarStation)) return null;
  if (!str(l.stationsUrl, 300) || !l.stationsUrl.startsWith('https://api.weather.gov/')) return null;
  return {
    lat: l.lat, lon: l.lon, office: l.office, radarStation: l.radarStation, stationsUrl: l.stationsUrl,
    label: str(l.label, 80) ? l.label : `${l.lat.toFixed(2)}, ${l.lon.toFixed(2)}`,
    city: str(l.city, 80) ? l.city : '',
    state: str(l.state, 40) ? l.state : '',
  };
}

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly persist = inject(Persist);
  readonly location = this.persist.signal<HomeLocation | null>('sw.location', null, sanitizeLocation);
  /** Jump to the default lineup channel when a danger-level alert starts. */
  readonly autoTune = this.persist.signal('sw.autoTune', true, v => (typeof v === 'boolean' ? v : null));
  /** Audio needs a user gesture each session, so this is not persisted. */
  readonly soundArmed = signal(false);
}
