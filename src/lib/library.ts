// Personal reference library: saved threads, saved posts, collections,
// watchlists and read state. Pure functions here, persistence in storage.ts.
import { matchFields, parseQuery } from './search';
import type { ForumPost, Thread } from './types';

export interface SavedBase {
  id: string; // "thread:<threadId>" or "post:<postId>" or "post:manual:<uuid>"
  savedAt: string;
  tags: string[];
  notes: string;
  collections: string[]; // collection ids
  read: boolean;
  excerpt?: string; // optional locally saved excerpt
}

export interface SavedThread extends SavedBase {
  kind: 'thread';
  threadId: string;
  source: string;
  title: string;
  url: string;
  category?: string;
  author?: string;
  publishedAt?: string; // thread creation date
  replies?: number;
}

export interface SavedPost extends SavedBase {
  kind: 'post';
  postId?: string; // absent for manual entries without a known id
  threadId?: string;
  source?: string; // may be "other" for manual entries
  title: string; // thread title or user-supplied title
  url: string; // exact permalink
  author?: string;
  publishedAt?: string;
  manual: boolean;
}

export type SavedItem = SavedThread | SavedPost;

export interface Collection {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  keywords: string[]; // each keyword may be a phrase ("duck canvas")
  sources: string[]; // empty = all forums
  createdAt: string;
  readUntil?: string; // activity before this counts as read
  readIds: string[]; // thread ids marked read individually ("id@lastPostAt")
}

export interface ReadMark {
  at: string; // when the user read it
  lastPostAt?: string; // the thread's last activity at that moment
}

export interface LibraryData {
  items: Record<string, SavedItem>;
  collections: Record<string, Collection>;
  watchlists: Record<string, Watchlist>;
  read: Record<string, ReadMark>; // threadId -> mark
}

export const emptyLibrary = (): LibraryData => ({ items: {}, collections: {}, watchlists: {}, read: {} });

export const DEFAULT_COLLECTIONS = ['Workwear', 'Military', 'Vintage Labels', 'Denim', 'Materials'];

export const nowIso = () => new Date().toISOString();

export function uid(prefix = ''): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + rnd;
}

export const threadItemId = (threadId: string) => `thread:${threadId}`;
export const postItemId = (postId: string) => `post:${postId}`;

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

// -- creating items ------------------------------------------------------------------

export function savedThreadFrom(t: Thread, opts: Partial<SavedBase> = {}): SavedThread {
  return {
    kind: 'thread',
    id: threadItemId(t.id),
    threadId: t.id,
    source: t.source,
    title: t.title,
    url: t.url,
    category: t.category,
    author: t.author,
    publishedAt: t.createdAt,
    replies: t.replies,
    savedAt: opts.savedAt ?? nowIso(),
    tags: normalizeTags(opts.tags ?? []),
    notes: opts.notes ?? '',
    collections: opts.collections ?? [],
    read: opts.read ?? false,
    excerpt: opts.excerpt,
  };
}

export function savedPostFrom(p: ForumPost, t: Thread, opts: Partial<SavedBase> = {}): SavedPost {
  return {
    kind: 'post',
    id: postItemId(p.id),
    postId: p.id,
    threadId: t.id,
    source: t.source,
    title: t.title,
    url: p.url,
    author: p.author,
    publishedAt: p.postedAt,
    manual: false,
    savedAt: opts.savedAt ?? nowIso(),
    tags: normalizeTags(opts.tags ?? []),
    notes: opts.notes ?? '',
    collections: opts.collections ?? [],
    read: opts.read ?? false,
    excerpt: opts.excerpt ?? p.excerpt,
  };
}

export interface ManualPostInput {
  url: string;
  title: string;
  notes?: string;
  author?: string;
  publishedAt?: string;
  source?: string;
  tags?: string[];
  collections?: string[];
  excerpt?: string;
}

export function validatePermalink(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only http(s) links are supported.';
    return null;
  } catch {
    return 'Enter a full link, starting with https://';
  }
}

export function manualPost(input: ManualPostInput, sourceForUrl?: (url: string) => string | undefined): SavedPost {
  const url = input.url.trim();
  return {
    kind: 'post',
    id: postItemId(`manual:${uid()}`),
    title: input.title.trim() || url,
    url,
    author: input.author?.trim() || undefined,
    publishedAt: input.publishedAt || undefined,
    source: input.source || sourceForUrl?.(url) || 'other',
    manual: true,
    savedAt: nowIso(),
    tags: normalizeTags(input.tags ?? []),
    notes: input.notes ?? '',
    collections: input.collections ?? [],
    read: false,
    excerpt: input.excerpt?.trim() || undefined,
  };
}

// -- updates (pure; return a new LibraryData) -----------------------------------------

export function putItem(lib: LibraryData, item: SavedItem): LibraryData {
  const prev = lib.items[item.id];
  // Re-saving keeps the user's tags/notes/collections and original save date.
  const merged = prev
    ? ({ ...item, savedAt: prev.savedAt, tags: normalizeTags([...prev.tags, ...item.tags]), notes: prev.notes || item.notes,
         collections: [...new Set([...prev.collections, ...item.collections])], read: prev.read } as SavedItem)
    : item;
  return { ...lib, items: { ...lib.items, [item.id]: merged } };
}

export function removeItem(lib: LibraryData, id: string): LibraryData {
  if (!lib.items[id]) return lib;
  const items = { ...lib.items };
  delete items[id];
  return { ...lib, items };
}

export function updateItem(lib: LibraryData, id: string, patch: Partial<Pick<SavedBase, 'tags' | 'notes' | 'collections' | 'read' | 'excerpt'>> & { title?: string }): LibraryData {
  const prev = lib.items[id];
  if (!prev) return lib;
  const next = { ...prev, ...patch } as SavedItem;
  if (patch.tags) next.tags = normalizeTags(patch.tags);
  return { ...lib, items: { ...lib.items, [id]: next } };
}

export function addCollection(lib: LibraryData, name: string, description?: string): [LibraryData, Collection] {
  const existing = Object.values(lib.collections).find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return [lib, existing];
  const c: Collection = { id: uid('col_'), name: name.trim(), description, createdAt: nowIso() };
  return [{ ...lib, collections: { ...lib.collections, [c.id]: c } }, c];
}

export function removeCollection(lib: LibraryData, id: string): LibraryData {
  const collections = { ...lib.collections };
  delete collections[id];
  const items: Record<string, SavedItem> = {};
  for (const [k, v] of Object.entries(lib.items)) items[k] = v.collections.includes(id) ? ({ ...v, collections: v.collections.filter((c) => c !== id) } as SavedItem) : v;
  return { ...lib, collections, items };
}

export function markThreadRead(lib: LibraryData, t: Pick<Thread, 'id' | 'lastPostAt'>, read = true): LibraryData {
  const marks = { ...lib.read };
  if (read) marks[t.id] = { at: nowIso(), lastPostAt: t.lastPostAt };
  else delete marks[t.id];
  const itemId = threadItemId(t.id);
  const items = lib.items[itemId] ? { ...lib.items, [itemId]: { ...lib.items[itemId], read } as SavedItem } : lib.items;
  return { ...lib, read: marks, items };
}

export type ReadState = 'unread' | 'read' | 'updated';

/** "updated" = read before, but there has been new activity since. */
export function readState(lib: LibraryData, t: Pick<Thread, 'id' | 'lastPostAt'>): ReadState {
  const m = lib.read[t.id];
  if (!m) return 'unread';
  if (t.lastPostAt && m.lastPostAt && t.lastPostAt > m.lastPostAt) return 'updated';
  return 'read';
}

// -- library browsing -------------------------------------------------------------------

export interface LibraryQuery {
  kind?: 'thread' | 'post';
  text?: string;
  tag?: string;
  collection?: string;
  source?: string;
  read?: 'read' | 'unread';
  sort?: 'saved' | 'published' | 'published-asc' | 'title';
}

export function queryLibrary(lib: LibraryData, q: LibraryQuery): SavedItem[] {
  const parsed = q.text ? parseQuery(q.text) : null;
  const items = Object.values(lib.items).filter((it) => {
    if (q.kind && it.kind !== q.kind) return false;
    if (q.tag && !it.tags.some((t) => t.toLowerCase() === q.tag!.toLowerCase())) return false;
    if (q.collection && !it.collections.includes(q.collection)) return false;
    if (q.source && it.source !== q.source) return false;
    if (q.read === 'read' && !it.read) return false;
    if (q.read === 'unread' && it.read) return false;
    if (parsed && (parsed.terms.length || parsed.phrases.length)) {
      const m = matchFields({ title: it.title, text: it.excerpt, author: it.author, extra: `${it.tags.join(' ')} ${it.notes}`, category: it.kind === 'thread' ? it.category : undefined }, parsed);
      if (!m) return false;
    }
    return true;
  });
  const by = q.sort ?? 'saved';
  const t = (s?: string) => (s ? Date.parse(s) || 0 : 0);
  items.sort((a, b) => {
    if (by === 'published') return t(b.publishedAt) - t(a.publishedAt);
    if (by === 'published-asc') return (t(a.publishedAt) || Infinity) - (t(b.publishedAt) || Infinity);
    if (by === 'title') return a.title.localeCompare(b.title);
    return t(b.savedAt) - t(a.savedAt);
  });
  return items;
}

export function allTags(lib: LibraryData): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const it of Object.values(lib.items))
    for (const tag of it.tags) {
      const k = tag.toLowerCase();
      const e = counts.get(k) ?? { tag, count: 0 };
      e.count++;
      counts.set(k, e);
    }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// -- export / import ----------------------------------------------------------------------

export const EXPORT_FORMAT = 'vintage-forum-reader-library';
export const EXPORT_VERSION = 1;

export interface LibraryExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  items: SavedItem[];
  collections: Collection[];
  watchlists: Watchlist[];
  read: Record<string, ReadMark>;
}

export function exportLibrary(lib: LibraryData): LibraryExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    items: Object.values(lib.items),
    collections: Object.values(lib.collections),
    watchlists: Object.values(lib.watchlists),
    read: lib.read,
  };
}

export interface ImportReport {
  items: number;
  collections: number;
  watchlists: number;
  skipped: number;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

function cleanItem(raw: unknown): SavedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !isStr(r.url) || !isStr(r.title) || (r.kind !== 'thread' && r.kind !== 'post')) return null;
  if (validatePermalink(r.url)) return null;
  const base = {
    id: r.id,
    url: r.url,
    title: r.title,
    savedAt: isStr(r.savedAt) ? r.savedAt : nowIso(),
    tags: Array.isArray(r.tags) ? normalizeTags(r.tags.filter(isStr)) : [],
    notes: isStr(r.notes) ? r.notes : '',
    collections: Array.isArray(r.collections) ? r.collections.filter(isStr) : [],
    read: r.read === true,
    excerpt: isStr(r.excerpt) ? r.excerpt : undefined,
    author: isStr(r.author) ? r.author : undefined,
    publishedAt: isStr(r.publishedAt) ? r.publishedAt : undefined,
    source: isStr(r.source) ? r.source : undefined,
  };
  if (r.kind === 'thread') {
    if (!isStr(r.threadId)) return null;
    return { ...base, kind: 'thread', threadId: r.threadId, source: base.source ?? r.threadId.split(':')[0], category: isStr(r.category) ? r.category : undefined, replies: typeof r.replies === 'number' ? r.replies : undefined };
  }
  return { ...base, kind: 'post', postId: isStr(r.postId) ? r.postId : undefined, threadId: isStr(r.threadId) ? r.threadId : undefined, manual: r.manual === true };
}

/** Merge an export into the library. Existing items keep their notes unless empty; tags/collections are unioned. */
export function importLibrary(lib: LibraryData, data: unknown): [LibraryData, ImportReport] {
  if (!data || typeof data !== 'object' || (data as LibraryExport).format !== EXPORT_FORMAT) {
    throw new Error('This file is not a Vintage Forum Reader library export.');
  }
  const d = data as LibraryExport;
  if (typeof d.version !== 'number' || d.version > EXPORT_VERSION) throw new Error(`Unsupported export version ${String(d.version)}.`);
  let next = lib;
  const report: ImportReport = { items: 0, collections: 0, watchlists: 0, skipped: 0 };
  for (const c of Array.isArray(d.collections) ? d.collections : []) {
    if (!c || !isStr(c.id) || !isStr(c.name)) { report.skipped++; continue; }
    if (!next.collections[c.id]) {
      next = { ...next, collections: { ...next.collections, [c.id]: { id: c.id, name: c.name, description: isStr(c.description) ? c.description : undefined, createdAt: isStr(c.createdAt) ? c.createdAt : nowIso() } } };
      report.collections++;
    }
  }
  for (const raw of Array.isArray(d.items) ? d.items : []) {
    const it = cleanItem(raw);
    if (!it) { report.skipped++; continue; }
    const prev = next.items[it.id];
    const merged = prev
      ? ({ ...prev, tags: normalizeTags([...prev.tags, ...it.tags]), notes: prev.notes || it.notes, collections: [...new Set([...prev.collections, ...it.collections])], read: prev.read || it.read, excerpt: prev.excerpt ?? it.excerpt } as SavedItem)
      : it;
    next = { ...next, items: { ...next.items, [it.id]: merged } };
    report.items++;
  }
  for (const w of Array.isArray(d.watchlists) ? d.watchlists : []) {
    if (!w || !isStr(w.id) || !isStr(w.name) || !Array.isArray(w.keywords)) { report.skipped++; continue; }
    if (!next.watchlists[w.id]) {
      next = { ...next, watchlists: { ...next.watchlists, [w.id]: { id: w.id, name: w.name, keywords: w.keywords.filter(isStr), sources: Array.isArray(w.sources) ? w.sources.filter(isStr) : [], createdAt: isStr(w.createdAt) ? w.createdAt : nowIso(), readUntil: isStr(w.readUntil) ? w.readUntil : undefined, readIds: Array.isArray(w.readIds) ? w.readIds.filter(isStr) : [] } } };
      report.watchlists++;
    }
  }
  if (d.read && typeof d.read === 'object') {
    const read = { ...next.read };
    for (const [k, v] of Object.entries(d.read)) if (v && isStr((v as ReadMark).at) && !read[k]) read[k] = v as ReadMark;
    next = { ...next, read };
  }
  return [next, report];
}
