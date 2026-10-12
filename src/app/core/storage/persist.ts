import { effect, inject, Injectable, signal, type WritableSignal } from '@angular/core';

import { STORAGE_BACKEND } from './storage-backend';

/** Signals backed by the configured StorageBackend, hydrated asynchronously. */
@Injectable({ providedIn: 'root' })
export class Persist {
  private readonly backend = inject(STORAGE_BACKEND);
  private readonly pending: Promise<unknown>[] = [];

  /**
   * A signal that loads `key` from storage and saves every change back.
   * Must be called in an injection context (e.g. a service field initializer).
   */
  signal<T>(key: string, fallback: T, validate?: (stored: unknown) => T | null): WritableSignal<T> {
    const s = signal<T>(fallback);
    let loaded = false;
    this.pending.push(
      this.backend.get<unknown>(key).catch(() => undefined).then(stored => {
        loaded = true;
        // If something wrote before hydration finished, that newer value wins.
        if (s() !== fallback) {this.save(key, s());}
        else if (stored !== undefined) {
          // Stored data may come from an older version or be corrupt: validate before use.
          const value = validate ? validate(stored) : (stored as T);
          if (value !== null && value !== undefined) {s.set(value);}
        }
      }),
    );
    effect(() => {
      const value = s();
      if (loaded) {this.save(key, value);}
    });
    return s;
  }

  private save<T>(key: string, value: T): void {
    const op = value === null || value === undefined ? this.backend.remove(key) : this.backend.set(key, value);
    op.catch(e => console.warn(`Storm Watch: could not save "${key}"`, e));
  }

  /** Resolves once every signal created so far has loaded its stored value. */
  async ready(): Promise<void> {
    return Promise.all(this.pending).then(() => undefined);
  }
}
