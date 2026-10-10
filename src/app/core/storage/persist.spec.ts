import { TestBed } from '@angular/core/testing';
import { Persist } from './persist';
import { STORAGE_BACKEND, StorageBackend } from './storage-backend';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) { return this.data.get(key) as T | undefined; }
  async set<T>(key: string, value: T) { this.data.set(key, value); }
  async remove(key: string) { this.data.delete(key); }
}

describe('Persist', () => {
  let backend: MemoryBackend;
  let persist: Persist;

  beforeEach(() => {
    backend = new MemoryBackend();
    TestBed.configureTestingModule({ providers: [{ provide: STORAGE_BACKEND, useValue: backend }] });
    persist = TestBed.inject(Persist);
  });

  const make = <T>(key: string, fallback: T) => TestBed.runInInjectionContext(() => persist.signal(key, fallback));

  it('rejects stored values that fail validation', async () => {
    backend.data.set('v', 'garbage');
    const s = TestBed.runInInjectionContext(() =>
      persist.signal<number[]>('v', [1], x => (Array.isArray(x) ? (x as number[]) : null)));
    await persist.ready();
    expect(s()).toEqual([1]);
  });

  it('hydrates from the backend', async () => {
    backend.data.set('k', { a: 1 });
    const s = make('k', { a: 0 });
    await persist.ready();
    expect(s()).toEqual({ a: 1 });
  });

  it('saves changes after hydration', async () => {
    const s = make('k', 1);
    await persist.ready();
    s.set(5);
    TestBed.tick();
    await Promise.resolve();
    expect(backend.data.get('k')).toBe(5);
  });

  it('keeps a value written before hydration finished', async () => {
    backend.data.set('k', 'old');
    const s = make('k', 'fallback');
    s.set('new');
    await persist.ready();
    expect(s()).toBe('new');
    expect(backend.data.get('k')).toBe('new');
  });

  it('removes the key when set to null', async () => {
    backend.data.set('k', 'x');
    const s = make<string | null>('k', 'fallback');
    await persist.ready();
    s.set(null);
    TestBed.tick();
    await Promise.resolve();
    expect(backend.data.has('k')).toBe(false);
  });
});
