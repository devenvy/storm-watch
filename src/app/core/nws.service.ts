import { Injectable } from '@angular/core';
import type { Geometry } from 'geojson';

const NWS = 'https://api.weather.gov';
const HEADERS = { Accept: 'application/geo+json' };
/** Requests that hang longer than this fail, so a poll never blocks the next one forever. */
export const FETCH_TIMEOUT_MS = 20_000;

export interface PointInfo {
  city: string;
  state: string;
  office: string;
  radarStation: string;
  stationsUrl: string;
}

export interface NwsAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  description: string;
  instruction: string;
  areaDesc: string;
  senderName: string;
  ends: string | null;
  expires: string;
  /** CAP parameters, e.g. tornadoDamageThreat / flashFloodDamageThreat: ['CATASTROPHIC']. */
  parameters?: Record<string, string[] | undefined>;
}

export interface Observation {
  station: string;
  stationName: string;
  timestamp: string;
  text: string;
  tempF: number | null;
  feelsLikeF: number | null;
  humidity: number | null;
  windMph: number | null;
  gustMph: number | null;
  windDir: number | null;
  pressureInHg: number | null;
}

export interface WarningShape {
  event: string;
  headline: string;
  geometry: Geometry;
}

/** Events that mean "act now" for the alerted location. */
export const DANGER_EVENTS =
  /Tornado Warning|Tornado Emergency|Flash Flood Emergency|Extreme Wind Warning|Hurricane Warning|Storm Surge Warning/;

/**
 * Tornado and Flash Flood *Emergencies* are issued as ordinary Warnings tagged with a
 * CATASTROPHIC damage threat, so the event name alone is not enough.
 */
export function isDanger(a: Pick<NwsAlert, 'event' | 'parameters'>): boolean {
  if (DANGER_EVENTS.test(a.event)) return true;
  const p = a.parameters ?? {};
  return [p['flashFloodDamageThreat'], p['tornadoDamageThreat']].some(v => v?.includes('CATASTROPHIC'));
}

/** Display name, upgrading CATASTROPHIC warnings to their "Emergency" name. */
export function dangerLabel(a: Pick<NwsAlert, 'event' | 'parameters'>): string {
  const p = a.parameters ?? {};
  if (p['tornadoDamageThreat']?.includes('CATASTROPHIC')) return 'Tornado Emergency';
  if (p['flashFloodDamageThreat']?.includes('CATASTROPHIC')) return 'Flash Flood Emergency';
  return a.event;
}

export const POLYGON_EVENTS = ['Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Extreme Wind Warning'];

const SEVERITY_RANK: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };

/** The slices of api.weather.gov responses this app reads. */
interface Value { value: number | null }
interface PointsResponse {
  properties: {
    cwa: string; radarStation: string; observationStations: string;
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
}
interface AlertsResponse {
  features: { properties: NwsAlert; geometry: Geometry | null }[];
}
interface StationsResponse { features: { properties: { stationIdentifier: string; name: string } }[] }
interface ObservationResponse {
  properties: {
    timestamp: string; textDescription: string;
    temperature?: Value; heatIndex?: Value; windChill?: Value; relativeHumidity?: Value;
    windSpeed?: Value; windGust?: Value; windDirection?: Value; barometricPressure?: Value;
  };
}

@Injectable({ providedIn: 'root' })
export class NwsService {
  private async get<T>(url: string): Promise<T> {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`NWS ${r.status} for ${url}`);
    return r.json() as Promise<T>;
  }

  async point(lat: number, lon: number): Promise<PointInfo> {
    const d = await this.get<PointsResponse>(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const p = d.properties;
    return {
      city: p.relativeLocation?.properties?.city ?? '',
      state: p.relativeLocation?.properties?.state ?? '',
      office: p.cwa,
      radarStation: p.radarStation,
      stationsUrl: p.observationStations,
    };
  }

  async alertsAt(lat: number, lon: number): Promise<NwsAlert[]> {
    const d = await this.get<AlertsResponse>(`${NWS}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
    return d.features
      .map(f => f.properties)
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));
  }

  async warningShapes(): Promise<WarningShape[]> {
    const ev = POLYGON_EVENTS.map(encodeURIComponent).join(',');
    const d = await this.get<AlertsResponse>(`${NWS}/alerts/active?status=actual&event=${ev}`);
    return d.features.flatMap(f =>
      f.geometry ? [{ event: f.properties.event, headline: f.properties.headline, geometry: f.geometry }] : []);
  }

  async latestObservation(stationsUrl: string): Promise<Observation> {
    const stations = await this.get<StationsResponse>(stationsUrl);
    const first = stations.features[0].properties;
    const d = await this.get<ObservationResponse>(`${NWS}/stations/${first.stationIdentifier}/observations/latest`);
    const p = d.properties;
    const cToF = (v: number | null | undefined) => (v == null ? null : Math.round((v * 9) / 5 + 32));
    const kmhToMph = (v: number | null | undefined) => (v == null ? null : Math.round(v * 0.621371));
    return {
      station: first.stationIdentifier,
      stationName: first.name,
      timestamp: p.timestamp,
      text: p.textDescription,
      tempF: cToF(p.temperature?.value),
      feelsLikeF: cToF(p.heatIndex?.value ?? p.windChill?.value ?? p.temperature?.value),
      humidity: p.relativeHumidity?.value == null ? null : Math.round(p.relativeHumidity.value),
      windMph: kmhToMph(p.windSpeed?.value),
      gustMph: kmhToMph(p.windGust?.value),
      windDir: p.windDirection?.value ?? null,
      pressureInHg: p.barometricPressure?.value == null ? null : +(p.barometricPressure.value / 3386.39).toFixed(2),
    };
  }
}
