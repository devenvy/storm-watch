const POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

const DEGREES_PER_CIRCLE = 360;
/** 360° / 16 compass points. */
const DEGREES_PER_POINT = 22.5;
const DEGREES_PER_HALF_TURN = 180;
const KNOTS_TO_MPH = 1.15078;
/** Mean Earth radius (3958.8 mi) × 2. */
const EARTH_DIAMETER_MILES = 7917.6;

/** Haversine of an angle in radians: sin²(θ/2). */
function hav(theta: number): number {
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- the halving and squaring are the haversine definition, not tunables
  return Math.sin(theta / 2) ** 2;
}

/** Compass point for a bearing in degrees ('' when unknown). */
export function compass(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) {
    return '';
  }
  return (
    POINTS[
      Math.round(
        (((deg % DEGREES_PER_CIRCLE) + DEGREES_PER_CIRCLE) % DEGREES_PER_CIRCLE) /
          DEGREES_PER_POINT,
      ) % POINTS.length
    ] ?? ''
  );
}

export function ktToMph(kt: number): number {
  return Math.round(kt * KNOTS_TO_MPH);
}

/** Great-circle distance in miles. */
export function miles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / DEGREES_PER_HALF_TURN;
  const a =
    hav((lat2 - lat1) * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * hav((lon2 - lon1) * r);
  return EARTH_DIAMETER_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}
