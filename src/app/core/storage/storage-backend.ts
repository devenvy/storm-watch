import { InjectionToken } from '@angular/core';

import { IndexedDbBackend } from './indexeddb.backend';

/**
 * Where app state lives. The browser build uses IndexedDB; a self-hosted build can
 * provide a backend that talks to a server-side data dir / SQLite instead, so every
 * device in the house shares one config.
 */
export interface StorageBackend {
  readonly name: string;
  get: <T>(key: string) => Promise<T | undefined>;
  set: <T>(key: string, value: T) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const STORAGE_BACKEND = new InjectionToken<StorageBackend>('STORAGE_BACKEND', {
  providedIn: 'root',
  factory: () => new IndexedDbBackend(),
});
