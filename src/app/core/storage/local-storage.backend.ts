import type { StorageBackend } from './storage-backend';

/** localStorage as JSON. Every access is guarded: it throws in some private modes. */
export class LocalStorageBackend implements StorageBackend {
  readonly name = 'localstorage';

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: state stays in memory */
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
