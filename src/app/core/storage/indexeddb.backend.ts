import { LocalStorageBackend } from './local-storage.backend';

import type { StorageBackend } from './storage-backend';

const DB = 'stormwatch';
const STORE = 'kv';

async function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * IndexedDB key/value store. Falls back to localStorage when IndexedDB is unavailable,
 * and migrates keys saved by earlier localStorage-only versions on first read.
 */
export class IndexedDbBackend implements StorageBackend {
  readonly name = 'indexeddb';
  private readonly legacy = new LocalStorageBackend();
  private readonly db: Promise<IDBDatabase | null> = this.open();

  private async open(): Promise<IDBDatabase | null> {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      return await req(r).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
    const db = await this.db;
    return db ? db.transaction(STORE, mode).objectStore(STORE) : null;
  }

  /** Run one write and resolve only once its transaction has committed. */
  private async write(op: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
    const store = await this.tx('readwrite');
    if (!store) {
      return false;
    }
    const t = store.transaction;
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      const fail = () => reject(t.error ?? new Error('IndexedDB write aborted'));
      t.onabort = fail;
      t.onerror = fail;
      op(store);
    });
    return true;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const store = await this.tx('readonly');
    if (!store) {
      return this.legacy.get<T>(key);
    }
    const value = await req<unknown>(store.get(key)).catch(() => undefined);
    if (value !== undefined) {
      return value as T;
    }
    const old = await this.legacy.get<T>(key);
    if (old !== undefined) {
      // Drop the legacy copy only after the new one is durably committed.
      try {
        await this.set(key, old);
        await this.legacy.remove(key);
      } catch {
        /* keep the localStorage copy; migration retries next load */
      }
    }
    return old;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!(await this.write((s) => s.put(value, key)))) {
      await this.legacy.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    if (!(await this.write((s) => s.delete(key)))) {
      await this.legacy.remove(key);
    }
  }
}
