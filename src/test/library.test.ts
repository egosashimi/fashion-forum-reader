import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addCollection, allTags, emptyLibrary, exportLibrary, importLibrary, manualPost, markThreadRead, putItem,
  queryLibrary, readState, removeCollection, removeItem, savedPostFrom, savedThreadFrom, threadItemId, updateItem,
  validatePermalink,
} from '../lib/library';
import { LibraryStorage } from '../lib/storage';
import { isNewForWatchlist, markWatchlistAllRead, markWatchlistItemRead, matchingKeywords, parseKeywords, watchlistMatches } from '../lib/watchlist';
import { byId, THREADS } from './fixtures';

const post = { id: 'ironheart:99022', url: 'https://forum.ironheart.co.uk/post/99022', author: 'Danny RnH', postedAt: '2011-09-02T07:22:28Z', position: 2, excerpt: 'are these VMC 666s sanforized?', page: 1 };

describe('saving threads (bookmarks)', () => {
  it('saves, re-saves without losing notes, and removes', () => {
    let lib = putItem(emptyLibrary(), savedThreadFrom(byId('vlj:20130'), { tags: ['Walls', 'walls', ' hunting '] }));
    const id = threadItemId('vlj:20130');
    expect(lib.items[id].tags).toEqual(['Walls', 'hunting']);
    lib = updateItem(lib, id, { notes: 'Label looks 1950s' });
    lib = putItem(lib, savedThreadFrom(byId('vlj:20130'), { tags: ['duck canvas'] }));
    expect(lib.items[id].notes).toBe('Label looks 1950s');
    expect(lib.items[id].tags).toEqual(['Walls', 'hunting', 'duck canvas']);
    lib = removeItem(lib, id);
    expect(lib.items[id]).toBeUndefined();
  });

  it('keeps the direct link and original publication date', () => {
    const it = savedThreadFrom(byId('ironheart:934'));
    expect(it.url).toBe('https://forum.ironheart.co.uk/topic/934/ih-666-xhs');
    expect(it.publishedAt).toBe('2011-09-02T06:05:34Z');
  });
});

describe('saving posts', () => {
  it('saves an individual post with its permalink and excerpt', () => {
    const it = savedPostFrom(post, byId('ironheart:934'));
    expect(it.id).toBe('post:ironheart:99022');
    expect(it.url).toBe(post.url);
    expect(it.excerpt).toBe(post.excerpt);
    expect(it.manual).toBe(false);
  });
  it('saves a manually supplied permalink', () => {
    expect(validatePermalink('not a url')).toBeTruthy();
    expect(validatePermalink('javascript:alert(1)')).toBeTruthy();
    expect(validatePermalink('https://www.thefedoralounge.com/threads/x.1/post-2')).toBeNull();
    const it = manualPost({ url: 'https://www.thefedoralounge.com/threads/x.1/post-2', title: 'Walls 1960s tag', notes: 'n' }, (u) => (u.includes('fedoralounge') ? 'fedoralounge' : undefined));
    expect(it.manual).toBe(true);
    expect(it.source).toBe('fedoralounge');
    expect(it.kind).toBe('post');
  });
});

describe('collections, tags and queries', () => {
  it('creates collections, files items and filters', () => {
    let lib = emptyLibrary();
    let workwear;
    [lib, workwear] = addCollection(lib, 'Workwear');
    const [lib2, same] = addCollection(lib, ' workwear ');
    expect(same.id).toBe(workwear.id);
    lib = lib2;
    lib = putItem(lib, savedThreadFrom(byId('vlj:20130'), { collections: [workwear.id], tags: ['Walls'] }));
    lib = putItem(lib, savedThreadFrom(byId('ironheart:934'), { tags: ['denim'] }));
    lib = putItem(lib, savedPostFrom(post, byId('ironheart:934'), { tags: ['denim', 'sanforized'] }));
    expect(queryLibrary(lib, { collection: workwear.id }).map((i) => i.id)).toEqual(['thread:vlj:20130']);
    expect(queryLibrary(lib, { kind: 'post' }).length).toBe(1);
    expect(queryLibrary(lib, { tag: 'DENIM' }).length).toBe(2);
    expect(queryLibrary(lib, { text: 'sanforized' }).map((i) => i.kind)).toEqual(['post']);
    expect(queryLibrary(lib, { text: 'walls' }).length).toBe(1); // matches the tag
    expect(queryLibrary(lib, { sort: 'published-asc' })[0].publishedAt).toBe('2011-09-02T06:05:34Z');
    expect(allTags(lib)[0]).toEqual({ tag: 'denim', count: 2 });
    lib = removeCollection(lib, workwear.id);
    expect(lib.items['thread:vlj:20130'].collections).toEqual([]);
  });
});

describe('read state', () => {
  it('tracks unread / read / updated', () => {
    const t = byId('fedoralounge:124285');
    let lib = putItem(emptyLibrary(), savedThreadFrom(t));
    expect(readState(lib, t)).toBe('unread');
    lib = markThreadRead(lib, t);
    expect(readState(lib, t)).toBe('read');
    expect(lib.items[threadItemId(t.id)].read).toBe(true);
    expect(readState(lib, { ...t, lastPostAt: '2026-11-09T00:00:00Z' })).toBe('updated');
    lib = markThreadRead(lib, t, false);
    expect(readState(lib, t)).toBe('unread');
  });
});

describe('export / import', () => {
  it('round-trips and merges without duplicating', () => {
    let lib = emptyLibrary();
    let col;
    [lib, col] = addCollection(lib, 'Denim');
    lib = putItem(lib, savedThreadFrom(byId('ironheart:934'), { collections: [col.id], notes: 'grail' }));
    lib = putItem(lib, savedPostFrom(post, byId('ironheart:934')));
    const json = JSON.parse(JSON.stringify(exportLibrary(lib)));
    const [restored, report] = importLibrary(emptyLibrary(), json);
    expect(report).toEqual({ items: 2, collections: 1, watchlists: 0, skipped: 0 });
    expect(restored.items['thread:ironheart:934'].notes).toBe('grail');
    const [again] = importLibrary(restored, json);
    expect(Object.keys(again.items).length).toBe(2);
  });
  it('rejects foreign files and skips invalid items', () => {
    expect(() => importLibrary(emptyLibrary(), { foo: 1 })).toThrow();
    const [, report] = importLibrary(emptyLibrary(), { format: 'vintage-forum-reader-library', version: 1, items: [{ id: 'x', kind: 'thread', title: 't', url: 'javascript:1', threadId: 'a:1' }, null] });
    expect(report.skipped).toBe(2);
  });
});

describe('IndexedDB storage', () => {
  it('persists diffs and loads them back', async () => {
    const storage = new LibraryStorage(indexedDB);
    await storage.clear();
    const a = emptyLibrary();
    const b = markThreadRead(putItem(a, savedThreadFrom(byId('vfg:5001'), { tags: ['Kakadu'] })), byId('vfg:5001'));
    await storage.sync(a, b);
    const loaded = await storage.load();
    expect(loaded.items['thread:vfg:5001'].tags).toEqual(['Kakadu']);
    expect(loaded.read['vfg:5001']).toBeTruthy();
    const c = removeItem(b, 'thread:vfg:5001');
    await storage.sync(b, c);
    expect((await storage.load()).items).toEqual({});
  });
});

describe('watchlists', () => {
  const wl = { id: 'w1', name: 'Workwear brands', keywords: parseKeywords('Walls, Kakadu, "duck canvas"; military surplus'), sources: [], createdAt: '2026-01-01T00:00:00Z', readIds: [] };

  it('parses keyword lists', () => {
    expect(wl.keywords).toEqual(['Walls', 'Kakadu', 'duck canvas', 'military surplus']);
  });
  it('matches threads by any keyword, phrases intact', () => {
    expect(matchingKeywords(byId('vlj:20130'), wl)).toEqual(['Walls', 'duck canvas']);
    expect(matchingKeywords(byId('vfg:5001'), wl)).toEqual(['Kakadu', 'duck canvas']);
    expect(watchlistMatches(THREADS, wl).map((m) => m.thread.id)).toEqual(['vfg:5001', 'vlj:20130']);
  });
  it('respects forum filters', () => {
    expect(watchlistMatches(THREADS, { ...wl, sources: ['vfg'] }).map((m) => m.thread.id)).toEqual(['vfg:5001']);
  });
  it('marks items and the whole list read; new activity makes them new again', () => {
    const t = byId('vfg:5001');
    expect(isNewForWatchlist(t, wl)).toBe(true);
    const w2 = markWatchlistItemRead(wl, t);
    expect(isNewForWatchlist(t, w2)).toBe(false);
    expect(isNewForWatchlist({ ...t, lastPostAt: '2026-11-09T00:00:00Z' }, w2)).toBe(true);
    const w3 = markWatchlistAllRead(wl, THREADS);
    expect(watchlistMatches(THREADS, w3).every((m) => !m.isNew)).toBe(true);
  });
});
