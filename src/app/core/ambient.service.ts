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
export const STALE_MS = 1_800_000; // 30 minutes
/** Readings timestamped further than this in the future (clock skew) are rejected. */
const MAX_FUTURE_SKEW_MS = 300_000; // 5 minutes
const BOX_NEAR_DEG = 0.15;
const BOX_WIDE_DEG = 0.4;
/** Search boxes, in degrees around home, tried until enough active stations are found. */
const BOXES = [BOX_NEAR_DEG, BOX_WIDE_DEG];
const WANT = 5;
const MAX_RESULTS = 10;
const MAX_LAT_DEG = 90;
const MAX_LON_DEG = 180;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 80;

/** Accepted range and rounding (decimal places) for each outdoor reading kept. */
const READINGS = {
  tempf: { lo: -80, hi: 140, dp: 0 },
  feelsLike: { lo: -100, hi: 180, dp: 0 },
  humidity: { lo: 0, hi: 100, dp: 0 },
  windspeedmph: { lo: 0, hi: 250, dp: 0 },
  windgustmph: { lo: 0, hi: 300, dp: 0 },
  maxdailygust: { lo: 0, hi: 300, dp: 0 },
  winddir: { lo: 0, hi: 360, dp: 0 },
  hourlyrainin: { lo: 0, hi: 50, dp: 2 },
  dailyrainin: { lo: 0, hi: 100, dp: 2 },
  eventrainin: { lo: 0, hi: 200, dp: 2 },
  baromrelin: { lo: 20, hi: 35, dp: 2 },
};

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
  info?: {
    name?: unknown;
    coords?: { coords?: { lat?: unknown; lon?: unknown }; location?: unknown };
  };
  lastData?: Record<string, unknown>;
}

/** A reading in range, rounded to its decimals (stations report e.g. 24.16 mph or 1.618 in). */
function reading(d: Record<string, unknown>, k: keyof typeof READINGS): number | null {
  const v = d[k];
  const { lo, hi, dp } = READINGS[k];
  return num(v, lo, hi) ? Number(v.toFixed(dp)) : null;
}

/** One device as a station, or null if it is stale, unlocated or has no outdoor temperature. */
function toStation(
  raw: RawDevice | null | undefined,
  lat: number,
  lon: number,
  now: number,
): PwsStation | null {
  if (!raw) {
    return null;
  }
  const { _id: id, info, lastData: d } = raw;
  const c = info?.coords?.coords;
  if (
    !d ||
    !c ||
    !num(c.lat, -MAX_LAT_DEG, MAX_LAT_DEG) ||
    !num(c.lon, -MAX_LON_DEG, MAX_LON_DEG) ||
    !str(id, MAX_ID_LENGTH)
  ) {
    return null;
  }
  const at = d['dateutc'];
  if (!num(at, now - STALE_MS, now + MAX_FUTURE_SKEW_MS)) {
    return null;
  }
  const tempF = reading(d, 'tempf');
  if (tempF === null) {
    return null;
  }
  return {
    id,
    name:
      str(info.name, MAX_NAME_LENGTH) && info.name.trim() ? info.name.trim() : 'Weather station',
    place: str(info.coords?.location, MAX_NAME_LENGTH) ? info.coords.location : '',
    distanceMi: miles(lat, lon, c.lat, c.lon),
    at,
    tempF,
    feelsLikeF: reading(d, 'feelsLike'),
    humidity: reading(d, 'humidity'),
    windMph: reading(d, 'windspeedmph'),
    gustMph: reading(d, 'windgustmph'),
    maxGustMph: reading(d, 'maxdailygust'),
    windDir: reading(d, 'winddir'),
    rainRateIn: reading(d, 'hourlyrainin'),
    rainTodayIn: reading(d, 'dailyrainin'),
    rainEventIn: reading(d, 'eventrainin'),
    pressureInHg: reading(d, 'baromrelin'),
  };
}

/**
 * Keep only stations that reported recently and have outdoor readings, nearest first.
 * Only outdoor weather fields are kept: owner addresses, MAC addresses and indoor readings are dropped.
 */
export function parseStations(
  body: unknown,
  lat: number,
  lon: number,
  now = Date.now(),
): PwsStation[] {
  const list = ((body ?? {}) as { data?: unknown }).data;
  if (!Array.isArray(list)) {
    throw new Error('Unexpected Ambient response');
  }
  const out: PwsStation[] = [];
  for (const raw of list as (RawDevice | null | undefined)[]) {
    const station = toStation(raw, lat, lon, now);
    if (station) {
      out.push(station);
    }
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
        $limit: '500',
      });
      const r = await fetch(`${AMBIENT}?${q}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!r.ok) {
        throw new Error(`Ambient ${r.status}`);
      }
      found = parseStations(await r.json(), lat, lon);
      if (found.length >= WANT) {
        break;
      }
    }
    return found.slice(0, MAX_RESULTS);
  }
}
