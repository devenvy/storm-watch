import { IndexedDbBackend } from './indexeddb.backend';
import { LocalStorageBackend } from './local-storage.backend';

type Handler = (() => void) | null;

/** Minimal async IDBRequest stand-in. */
class FakeRequest<T> {
  result: T | undefined;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;

  settle(result: T | undefined, error: Error | null = null): this {
    setTimeout(() => {
      this.result = result;
      this.error = error;
      if (error) {
        this.onerror?.();
      } else {
        this.onsuccess?.();
      }
    });
    return this;
  }
}

interface Faults {
  openError?: boolean;
  getError?: boolean;
  abortWrites?: boolean;
}

/** An in-memory IndexedDB with one object store and injectable failures. */
function fakeIndexedDb(faults: Faults = {}) {
  const data = new Map<string, unknown>();
  const stores: string[] = [];
  const db = {
    createObjectStore: (name: string) => stores.push(name),
    transaction: () => {
      const tx = {
        oncomplete: null as Handler,
        onabort: null as Handler,
        onerror: null as Handler,
        error: null as Error | null,
        objectStore: (): unknown => null,
      };
      const finish = () => {
        setTimeout(() => {
          if (faults.abortWrites) {
            tx.onabort?.();
          } else {
            tx.oncomplete?.();
          }
        });
      };
      const store = {
        transaction: tx,
        get: (key: string) =>
          new FakeRequest<unknown>().settle(
            data.get(key),
            faults.getError ? new Error('get failed') : null,
          ),
        put: (value: unknown, key: string) => {
          if (!faults.abortWrites) {
            data.set(key, value);
          }
          finish();
          return new FakeRequest<string>().settle(key);
        },
        delete: (key: string) => {
          if (!faults.abortWrites) {
            data.delete(key);
          }
          finish();
          return new FakeRequest<undefined>().settle(undefined);
        },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
  const factory = {
    open: () => {
      const r = new FakeRequest<typeof db>();
      setTimeout(() => {
        r.result = db;
        r.onupgradeneeded?.();
      });
      return r.settle(faults.openError ? undefined : db, faults.openError ? new Error('x') : null);
    },
  };
  return { factory, data, stores };
}

describe('IndexedDbBackend', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores, reads and removes values in IndexedDB', async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const b = new IndexedDbBackend();
    expect(b.name).toBe('indexeddb');
    await b.set('k', { a: 1 });
    expect(idb.stores).toEqual(['kv']);
    expect(idb.data.get('k')).toEqual({ a: 1 });
    await expect(b.get('k')).resolves.toEqual({ a: 1 });
    await b.remove('k');
    expect(idb.data.has('k')).toBe(false);
    await expect(b.get('k')).resolves.toBeUndefined();
    expect(localStorage).toHaveLength(0);
  });

  it('migrates a legacy localStorage value on first read', async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    localStorage.setItem('k', JSON.stringify('old'));
    const b = new IndexedDbBackend();
    await expect(b.get('k')).resolves.toBe('old');
    expect(idb.data.get('k')).toBe('old');
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('keeps the legacy copy when the migration write is aborted', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb({ abortWrites: true }).factory);
    localStorage.setItem('k', JSON.stringify('old'));
    const b = new IndexedDbBackend();
    await expect(b.get('k')).resolves.toBe('old');
    expect(localStorage.getItem('k')).toBe('"old"');
  });

  it('rejects writes whose transaction aborts', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb({ abortWrites: true }).factory);
    const b = new IndexedDbBackend();
    await expect(b.set('k', 1)).rejects.toThrow('IndexedDB write aborted');
  });

  it('treats a failed read as missing and falls back to the legacy store', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb({ getError: true }).factory);
    const b = new IndexedDbBackend();
    await expect(b.get('missing')).resolves.toBeUndefined();
  });

  it('falls back to localStorage when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb({ openError: true }).factory);
    const b = new IndexedDbBackend();
    await b.set('k', [1, 2]);
    expect(localStorage.getItem('k')).toBe('[1,2]');
    await expect(b.get('k')).resolves.toEqual([1, 2]);
    await b.remove('k');
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('falls back to localStorage when IndexedDB is missing entirely', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const b = new IndexedDbBackend();
    await b.set('k', 'v');
    await expect(b.get('k')).resolves.toBe('v');
  });
});

describe('LocalStorageBackend', () => {
  const b = new LocalStorageBackend();

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips JSON values', async () => {
    expect(b.name).toBe('localstorage');
    await b.set('k', { x: [1] });
    await expect(b.get('k')).resolves.toEqual({ x: [1] });
    await b.remove('k');
    await expect(b.get('k')).resolves.toBeUndefined();
  });

  it('returns undefined for corrupt JSON', async () => {
    localStorage.setItem('k', '{nope');
    await expect(b.get('k')).resolves.toBeUndefined();
  });

  it('swallows storage exceptions (private mode)', async () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    await expect(b.get('k')).resolves.toBeUndefined();
    await expect(b.set('k', 1)).resolves.toBeUndefined();
    await expect(b.remove('k')).resolves.toBeUndefined();
  });
});
