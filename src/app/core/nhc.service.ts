import { Injectable } from '@angular/core';

import { FETCH_TIMEOUT_MS } from './nws.service';

/**
 * NHC's CurrentStorms.json has no CORS headers, so storms come from NOAA's tropical
 * ArcGIS service instead, which does. Each basin has five storm "bins" (AT1-AT5, EP1-EP5,
 * CP1-CP5), each with its own forecast-points layer; the tau=0 point is the current position.
 */
const MAPSERVER = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
/** Layer id of "<bin> Forecast Points": bins are laid out 26 layer ids apart, starting at 6. */
const BINS = ['AT', 'EP', 'CP'].flatMap(b => [1, 2, 3, 4, 5].map(n => `${b}${n}`));
const pointsLayer = (i: number) => 6 + i * 26;

export interface Storm {
  id: string;
  name: string;
  classification: string;
  intensityKt: number;
  pressureMb: number | null;
  lat: number;
  lon: number;
  movementDir: number | null;
  movementMph: number | null;
  advisory: string;
  coneImage: string;
  advisoryUrl: string;
}

const KT_TO_MPH = 1.15078;

/**
 * NHC's cone graphic lives under a folder per storm (AL09 -> AT09). The file name after
 * the "+png/" folder is ignored by NHC and only busts caches, so use the advisory number.
 */
function coneUrl(id: string, advisory: string): string {
  const dir = id.slice(0, 2).replace('AL', 'AT') + id.slice(2, 4);
  return `https://www.nhc.noaa.gov/storm_graphics/${dir}/refresh/${id}_5day_cone+png/${encodeURIComponent(advisory)}_5day_cone.png`;
}
const known = (n: number) => (n === 9999 ? null : n);

@Injectable({ providedIn: 'root' })
export class NhcService {
  async activeStorms(): Promise<Storm[]> {
    const results = await Promise.all(BINS.map(async (bin, i) => this.current(bin, pointsLayer(i))));
    return results.filter((s): s is Storm => Boolean(s));
  }

  private async current(bin: string, layer: number): Promise<Storm | null> {
    const q = `${MAPSERVER}/${layer}/query?where=tau%3D0&outFields=*&returnGeometry=false&f=json`;
    const r = await fetch(q, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) {throw new Error(`NHC ${r.status}`);}
    const d = await r.json();
    if (d.error) {throw new Error(`NHC: ${d.error.message}`);}
    const a = d.features?.[0]?.attributes;
    if (!a) {return null;}
    const id = String(a.idp_source ?? '').split('-')[0].toUpperCase();
    const speedKt = known(a.tcspd);
    return {
      id,
      name: a.stormname,
      classification: a.tcdvlp,
      intensityKt: a.maxwind,
      pressureMb: known(a.mslp),
      lat: a.lat,
      lon: a.lon,
      movementDir: known(a.tcdir),
      // NHC forecast points give motion in knots.
      movementMph: speedKt === null ? null : Math.round(speedKt * KT_TO_MPH),
      advisory: `Advisory ${a.advisnum} · ${a.advdate}`,
      coneImage: coneUrl(id, a.advisnum),
      advisoryUrl: `https://www.nhc.noaa.gov/text/MIATCP${bin}.shtml`,
    };
  }
}
