import type { FeedSort, Metric, Thread, TimeWindow } from './types';

const ts = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

export function compareThreads(sort: FeedSort): (a: Thread, b: Thread) => number {
  switch (sort) {
    case 'newest':
      return (a, b) => ts(b.createdAt) - ts(a.createdAt) || ts(b.lastPostAt) - ts(a.lastPostAt);
    case 'replies':
      return (a, b) => (b.replies ?? -1) - (a.replies ?? -1) || ts(b.lastPostAt) - ts(a.lastPostAt);
    case 'views':
      return (a, b) => (b.views ?? -1) - (a.views ?? -1) || ts(b.lastPostAt) - ts(a.lastPostAt);
    case 'updated':
    default:
      return (a, b) => ts(b.lastPostAt ?? b.createdAt) - ts(a.lastPostAt ?? a.createdAt);
  }
}

export function sortThreads(threads: Thread[], sort: FeedSort): Thread[] {
  return [...threads].sort(compareThreads(sort));
}

export interface ThreadFilter {
  sources?: string[]; // empty/undefined = all
  categories?: string[]; // "<source>|<categoryId>"; empty = all
  excludePinned?: boolean;
  excludeMegathreads?: boolean;
  unreadOnly?: boolean;
  isRead?: (t: Thread) => boolean;
}

export const categoryKey = (source: string, categoryId: string) => `${source}|${categoryId}`;

export function filterThreads(threads: Thread[], f: ThreadFilter): Thread[] {
  const sources = f.sources?.length ? new Set(f.sources) : null;
  const cats = f.categories?.length ? new Set(f.categories) : null;
  return threads.filter((t) => {
    if (sources && !sources.has(t.source)) return false;
    if (cats && !cats.has(categoryKey(t.source, t.categoryId))) return false;
    if (f.excludePinned && t.pinned) return false;
    if (f.excludeMegathreads && t.megathread) return false;
    if (f.unreadOnly && f.isRead?.(t)) return false;
    return true;
  });
}

/** Remove duplicates by stable id, keeping the record with more information. */
export function dedupeThreads(threads: Thread[]): Thread[] {
  const by = new Map<string, Thread>();
  for (const t of threads) {
    const prev = by.get(t.id);
    if (!prev) by.set(t.id, t);
    else
      by.set(t.id, {
        ...prev,
        ...t,
        excerpt: t.excerpt ?? prev.excerpt,
        replies: Math.max(prev.replies ?? -1, t.replies ?? -1) >= 0 ? Math.max(prev.replies ?? 0, t.replies ?? 0) : undefined,
        views: Math.max(prev.views ?? -1, t.views ?? -1) >= 0 ? Math.max(prev.views ?? 0, t.views ?? 0) : undefined,
        lastPostAt: [prev.lastPostAt, t.lastPostAt].filter(Boolean).sort().pop(),
        createdAt: [prev.createdAt, t.createdAt].filter(Boolean).sort()[0],
      });
  }
  return [...by.values()];
}

export const leaderboardKey = (metric: Metric, window: TimeWindow, clean: boolean, category?: string) =>
  `${category ? `cat:${category}:` : ''}${metric}:${window}:${clean ? 'clean' : 'any'}`;
