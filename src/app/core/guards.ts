/** Guards for untrusted data (imported files, share links). */

const MAX_URL_LENGTH = 2000;

export const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
export const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const webUrl = (v: unknown): v is string => {
  if (!str(v, MAX_URL_LENGTH)) {
    return false;
  }
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};
