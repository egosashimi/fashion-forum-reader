// IndexedDB persistence for the personal library. Each saved item,
// collection and watchlist is its own record, so a single change is a single
// small write. Read marks live in one record (a compact map).
import type { Collection, LibraryData, ReadMark, SavedItem, Watchlist } from './library';
import { emptyLibrary } from './library';

const DB_NAME = 'vintage-forum-reader';
const DB_VERSION = 1;
const STORES = ['items', 'collections', 'watchlists', 'meta'] as const;
type StoreName = (typeof STORES)[number];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class LibraryStorage {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined) {}

  get available(): boolean {
    return !!this.factory;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
    if (!this.dbp) {
      const open = this.factory.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
      };
      this.dbp = req(open);
    }
    return this.dbp;
  }

  private async tx(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => void): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      fn(t);
    });
  }

  async load(): Promise<LibraryData> {
    const db = await this.db();
    const t = db.transaction([...STORES], 'readonly');
    const [items, collections, watchlists, readRec] = await Promise.all([
      req(t.objectStore('items').getAll() as IDBRequest<SavedItem[]>),
      req(t.objectStore('collections').getAll() as IDBRequest<Collection[]>),
      req(t.objectStore('watchlists').getAll() as IDBRequest<Watchlist[]>),
      req(t.objectStore('meta').get('read') as IDBRequest<{ key: string; value: Record<string, ReadMark> } | undefined>),
    ]);
    const lib = emptyLibrary();
    for (const i of items) lib.items[i.id] = i;
    for (const c of collections) lib.collections[c.id] = c;
    for (const w of watchlists) lib.watchlists[w.id] = w;
    lib.read = readRec?.value ?? {};
    return lib;
  }

  /** Persist the difference between two library states. */
  async sync(prev: LibraryData, next: LibraryData): Promise<void> {
    const diff = <T>(a: Record<string, T>, b: Record<string, T>) => ({
      put: Object.entries(b).filter(([k, v]) => a[k] !== v).map(([, v]) => v),
      del: Object.keys(a).filter((k) => !(k in b)),
    });
    const items = diff(prev.items, next.items);
    const cols = diff(prev.collections, next.collections);
    const wls = diff(prev.watchlists, next.watchlists);
    const readChanged = prev.read !== next.read;
    if (!items.put.length && !items.del.length && !cols.put.length && !cols.del.length && !wls.put.length && !wls.del.length && !readChanged) return;
    await this.tx([...STORES], 'readwrite', (t) => {
      const apply = (name: StoreName, d: { put: unknown[]; del: string[] }) => {
        const s = t.objectStore(name);
        d.put.forEach((v) => s.put(v));
        d.del.forEach((k) => s.delete(k));
      };
      apply('items', items);
      apply('collections', cols);
      apply('watchlists', wls);
      if (readChanged) t.objectStore('meta').put({ key: 'read', value: next.read });
    });
  }

  async clear(): Promise<void> {
    await this.tx([...STORES], 'readwrite', (t) => STORES.forEach((s) => t.objectStore(s).clear()));
  }
}
