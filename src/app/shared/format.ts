const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass point for a bearing in degrees ('' when unknown). */
export function compass(deg: number | null | undefined): string {
  if (deg == null) return '';
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function ktToMph(kt: number): number {
  return Math.round(kt * 1.15078);
}
