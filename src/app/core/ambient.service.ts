import { Injectable } from '@angular/core';

import { num, str } from './guards';
import { FETCH_TIMEOUT_MS } from './nws.service';
import { miles } from '../shared/format';

/**
 * Public stations on the Ambient Weather Network (the map at ambientweather.net). This is the same keyless,
 * CORS-enabled endpoint the network map and Home Assistant's `ambient_network` integration use; it is
 * undocumented, so everything it returns is validated and the feed is treated as optional.
 */
const AMBIENT = 'https://lightning.ambientweather.net/devices';
/** Stations that haven't reported for this long are treated as offline (many listed stations are long dead). */
export const STALE_MS = 30 * 60_000;
/** Search boxes, in degrees around home, tried until enough active stations are found. */
const BOXES = [0.15, 0.4];
const WANT = 5;

export interface PwsStation {
  id: string;
  name: string;
  place: string;
  distanceMi: number;
  at: number;
  tempF: number | null;
  feelsLikeF: number | null;
  humidity: number | null;
  windMph: number | null;
  gustMph: number | null;
  maxGustMph: number | null;
  windDir: number | null;
  rainRateIn: number | null;
  rainTodayIn: number | null;
  rainEventIn: number | null;
  pressureInHg: number | null;
}

interface RawDevice {
  _id?: unknown;
  info?: { name?: unknown; coords?: { coords?: { lat?: unknown; lon?: unknown }; location?: unknown } };
  lastData?: Record<string, unknown>;
}

/**
 * Keep only stations that reported recently and have outdoor readings, nearest first.
 * Only outdoor weather fields are kept: owner addresses, MAC addresses and indoor readings are dropped.
 */
export function parseStations(body: unknown, lat: number, lon: number, now = Date.now()): PwsStation[] {
  const list = (body as { data?: unknown })?.data;
  if (!Array.isArray(list)) {throw new Error('Unexpected Ambient response');}
  /** A reading in range, rounded to `dp` decimals (stations report e.g. 24.16 mph or 1.618 in). */
  const val = (d: Record<string, unknown>, k: string, lo: number, hi: number, dp = 0) => {
    const v = d[k];
    return num(v, lo, hi) ? +v.toFixed(dp) : null;
  };
  const out: PwsStation[] = [];
  for (const raw of list as RawDevice[]) {
    const d = raw?.lastData;
    const c = raw?.info?.coords?.coords;
    if (!d || !c || !num(c.lat, -90, 90) || !num(c.lon, -180, 180) || !str(raw._id, 64)) {continue;}
    const at = d['dateutc'];
    if (!num(at, now - STALE_MS, now + 5 * 60_000)) {continue;}
    const tempF = val(d, 'tempf', -80, 140);
    if (tempF == null) {continue;}
    out.push({
      id: raw._id,
      name: str(raw.info?.name, 80) && raw.info.name.trim() ? raw.info.name.trim() : 'Weather station',
      place: str(raw.info?.coords?.location, 80) ? raw.info.coords.location : '',
      distanceMi: miles(lat, lon, c.lat, c.lon),
      at,
      tempF,
      feelsLikeF: val(d, 'feelsLike', -100, 180),
      humidity: val(d, 'humidity', 0, 100),
      windMph: val(d, 'windspeedmph', 0, 250),
      gustMph: val(d, 'windgustmph', 0, 300),
      maxGustMph: val(d, 'maxdailygust', 0, 300),
      windDir: val(d, 'winddir', 0, 360),
      rainRateIn: val(d, 'hourlyrainin', 0, 50, 2),
      rainTodayIn: val(d, 'dailyrainin', 0, 100, 2),
      rainEventIn: val(d, 'eventrainin', 0, 200, 2),
      pressureInHg: val(d, 'baromrelin', 20, 35, 2),
    });
  }
  return out.sort((a, b) => a.distanceMi - b.distanceMi);
}

@Injectable({ providedIn: 'root' })
export class AmbientService {
  /** Active stations near a point, nearest first. Widens the search if few are reporting nearby. */
  async nearby(lat: number, lon: number): Promise<PwsStation[]> {
    let found: PwsStation[] = [];
    for (const deg of BOXES) {
      const q = new URLSearchParams({
        '$publicBox[0][0]': String(lon - deg),
        '$publicBox[0][1]': String(lat - deg),
        '$publicBox[1][0]': String(lon + deg),
        '$publicBox[1][1]': String(lat + deg),
        '$limit': '500',
      });
      const r = await fetch(`${AMBIENT}?${q}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) {throw new Error(`Ambient ${r.status}`);}
      found = parseStations(await r.json(), lat, lon);
      if (found.length >= WANT) {break;}
    }
    return found.slice(0, 10);
  }
}
