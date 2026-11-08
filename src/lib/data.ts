// Loading and decoding of the static data files. Everything except the
// manifest and feed is fetched lazily and cached for the session.
import type { ChunkRef, IndexRow, Leaderboard, Manifest, RawThread, SourceInfo, Thread, ThreadPosts } from './types';

export const FLAG_PINNED = 1;
export const FLAG_MEGA = 2;
export const FLAG_REPLIES_APPROX = 4;
export const FLAG_VIEWS_APPROX = 8;
export const FLAG_LOCKED = 16;

const DATA_BASE = `${import.meta.env?.BASE_URL ?? './'}data/`;

const jsonCache = new Map<string, Promise<unknown>>();

export async function fetchJson<T>(path: string): Promise<T> {
  const url = DATA_BASE + path;
  let p = jsonCache.get(url);
  if (!p) {
    p = fetch(url, { cache: path === 'manifest.json' || path === 'feed.json' ? 'no-cache' : 'default' }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => jsonCache.delete(url));
    jsonCache.set(url, p);
  }
  return p as Promise<T>;
}

export function decodeThread(r: RawThread): Thread {
  const f = r.f ?? 0;
  return {
    id: r.id,
    source: r.s,
    title: r.t,
    url: r.u,
    category: r.c,
    categoryId: r.ci,
    author: r.a,
    createdAt: r.ca,
    lastPostAt: r.la,
    replies: r.r,
    views: r.v,
    pinned: (f & FLAG_PINNED) !== 0,
    megathread: (f & FLAG_MEGA) !== 0,
    repliesApprox: (f & FLAG_REPLIES_APPROX) !== 0,
    viewsApprox: (f & FLAG_VIEWS_APPROX) !== 0,
    locked: (f & FLAG_LOCKED) !== 0,
    excerpt: r.e,
    postPages: r.pp,
  };
}

export function decodeIndexRow(row: IndexRow, source: SourceInfo): Thread {
  const [tid, title, catIdx, created, last, replies, views, f, author] = row;
  const cat = source.categories[catIdx];
  const day = (d: string | null) => (d ? `${d}T00:00:00Z` : undefined);
  return {
    id: `${source.id}:${tid}`,
    source: source.id,
    title,
    url: source.baseUrl.replace(/\/$/, '') + source.threadUrl.replace('{id}', tid),
    category: cat?.name ?? '',
    categoryId: cat?.id ?? '',
    author: author ?? undefined,
    createdAt: day(created),
    lastPostAt: day(last),
    replies: replies ?? undefined,
    views: views ?? undefined,
    pinned: (f & FLAG_PINNED) !== 0,
    megathread: (f & FLAG_MEGA) !== 0,
    repliesApprox: (f & FLAG_REPLIES_APPROX) !== 0,
    viewsApprox: (f & FLAG_VIEWS_APPROX) !== 0,
    locked: (f & FLAG_LOCKED) !== 0,
  };
}

// -- thread registry: anything loaded is available to the thread view --------
const registry = new Map<string, Thread>();

/** Remember threads; full records (with canonical URL/excerpt) win over index rows. */
export function registerThreads(threads: Thread[], full = true): void {
  for (const t of threads) {
    const prev = registry.get(t.id);
    if (!prev) registry.set(t.id, t);
    else if (full) registry.set(t.id, { ...prev, ...t, excerpt: t.excerpt ?? prev.excerpt, postPages: t.postPages ?? prev.postPages });
  }
}

export function getRegisteredThread(id: string): Thread | undefined {
  return registry.get(id);
}

// -- loaders ---------------------------------------------------------------------
export const loadManifest = () => fetchJson<Manifest>('manifest.json');

export async function loadFeed(): Promise<{ generatedAt: string; days: number; threads: Thread[] }> {
  const raw = await fetchJson<{ generatedAt: string; days: number; threads: RawThread[] }>('feed.json');
  const threads = raw.threads.map(decodeThread);
  registerThreads(threads);
  return { ...raw, threads };
}

export async function loadLeaderboard(scope: string): Promise<{ lists: Record<string, string[]>; threads: Map<string, Thread>; generatedAt: string }> {
  const raw = await fetchJson<Leaderboard>(`leaderboards/${scope}.json`);
  const threads = new Map(Object.entries(raw.threads).map(([id, r]) => [id, decodeThread(r)]));
  registerThreads([...threads.values()]);
  return { lists: raw.lists, threads, generatedAt: raw.generatedAt };
}

export async function loadIndexChunk(chunk: ChunkRef, source: SourceInfo): Promise<Thread[]> {
  const rows = await fetchJson<IndexRow[]>(chunk.file);
  const threads = rows.map((r) => decodeIndexRow(r, source));
  registerThreads(threads, false);
  return threads;
}

export async function loadTextChunk(chunk: ChunkRef): Promise<Map<string, string>> {
  const rows = await fetchJson<[string, string][]>(chunk.file);
  return new Map(rows.map(([tid, text]) => [`${chunk.source}:${tid}`, text]));
}

interface RawPost {
  id: string;
  u: string;
  a?: string;
  d?: string;
  n?: number;
  e?: string;
  pg?: number;
}

export function decodePosts(raw: { id: string; pageCount?: number | null; pagesIndexed: number[]; posts: RawPost[] }): ThreadPosts {
  return {
    id: raw.id,
    pageCount: raw.pageCount,
    pagesIndexed: raw.pagesIndexed,
    posts: raw.posts.map((p) => ({ id: p.id, url: p.u, author: p.a, postedAt: p.d, position: p.n, excerpt: p.e ?? '', page: p.pg ?? 1 })),
  };
}

export async function loadThreadPosts(threadId: string): Promise<ThreadPosts | null> {
  const [source, tid] = splitId(threadId);
  try {
    return decodePosts(await fetchJson(`posts/${source}/${encodeURIComponent(tid)}.json`));
  } catch {
    return null;
  }
}

/** Find a thread that is not in memory yet (e.g. a deep link) via the search index. */
export async function findThread(manifest: Manifest, id: string): Promise<Thread | undefined> {
  const known = getRegisteredThread(id);
  if (known) return known;
  const [sourceId] = splitId(id);
  const source = manifest.sources.find((s) => s.id === sourceId);
  if (!source) return undefined;
  for (const chunk of manifest.index.filter((c) => c.source === sourceId)) {
    const hit = (await loadIndexChunk(chunk, source)).find((t) => t.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function splitId(id: string): [string, string] {
  const i = id.indexOf(':');
  return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)];
}
