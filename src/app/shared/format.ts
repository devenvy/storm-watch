const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass point for a bearing in degrees ('' when unknown). */
export function compass(deg: number | null | undefined): string {
  if (deg == null) return '';
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function ktToMph(kt: number): number {
  return Math.round(kt * 1.15078);
}

/** Great-circle distance in miles. */
export function miles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
