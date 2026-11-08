import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as L from '../lib/library';
import type { LibraryData, SavedItem, Watchlist } from '../lib/library';
import { LibraryStorage } from '../lib/storage';
import type { Thread } from '../lib/types';

interface LibraryApi {
  lib: LibraryData;
  ready: boolean;
  persistError: string | null;
  update: (fn: (lib: LibraryData) => LibraryData) => void;
  isSaved: (itemId: string) => boolean;
  toggleThread: (t: Thread) => void;
  markRead: (t: Pick<Thread, 'id' | 'lastPostAt'>, read?: boolean) => void;
  putItem: (item: SavedItem) => void;
  saveWatchlist: (w: Watchlist) => void;
  removeWatchlist: (id: string) => void;
  replaceAll: (lib: LibraryData) => void;
}

const Ctx = createContext<LibraryApi | null>(null);
const storage = new LibraryStorage();

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<LibraryData>(L.emptyLibrary);
  const [ready, setReady] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const current = useRef(lib);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (!storage.available) {
      setPersistError('This browser does not allow IndexedDB storage (private mode?). Saved items will be lost when you close the tab. Export them before leaving.');
      setReady(true);
      return;
    }
    storage
      .load()
      .then((stored) => {
        let initial = stored;
        if (Object.keys(stored.collections).length === 0 && Object.keys(stored.items).length === 0) {
          // First visit: suggest the starter collections from the brief.
          for (const name of L.DEFAULT_COLLECTIONS) initial = L.addCollection(initial, name)[0];
          const seeded = initial;
          queue.current = queue.current.then(() => storage.sync(stored, seeded));
        }
        current.current = initial;
        setLib(initial);
      })
      .catch((e: Error) => setPersistError(`Could not open local storage: ${e.message}`))
      .finally(() => setReady(true));
  }, []);

  const update = useCallback((fn: (lib: LibraryData) => LibraryData) => {
    const prev = current.current;
    const next = fn(prev);
    if (next === prev) return;
    current.current = next;
    setLib(next);
    if (storage.available)
      queue.current = queue.current
        .then(() => storage.sync(prev, next))
        .catch((e: Error) => setPersistError(`Saving failed: ${e.message}`));
  }, []);

  const api = useMemo<LibraryApi>(
    () => ({
      lib,
      ready,
      persistError,
      update,
      isSaved: (id) => !!lib.items[id],
      toggleThread: (t) =>
        update((l) => (l.items[L.threadItemId(t.id)] ? L.removeItem(l, L.threadItemId(t.id)) : L.putItem(l, L.savedThreadFrom(t, { read: !!l.read[t.id] })))),
      markRead: (t, read = true) => update((l) => L.markThreadRead(l, t, read)),
      putItem: (item) => update((l) => L.putItem(l, item)),
      saveWatchlist: (w) => update((l) => ({ ...l, watchlists: { ...l.watchlists, [w.id]: w } })),
      removeWatchlist: (id) =>
        update((l) => {
          const watchlists = { ...l.watchlists };
          delete watchlists[id];
          return { ...l, watchlists };
        }),
      replaceAll: (next) => update(() => next),
    }),
    [lib, ready, persistError, update],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary outside provider');
  return v;
}
