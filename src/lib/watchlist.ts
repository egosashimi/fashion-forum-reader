import type { Watchlist } from './library';
import { matchFields, parseQuery } from './search';
import type { Thread } from './types';

/** Parse "Walls, Kakadu, duck canvas" into keywords. */
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[,\n;]+/)
    .map((k) => k.trim().replace(/^"|"$/g, '').replace(/\s+/g, ' '))
    .filter((k) => k && !seen.has(k.toLowerCase()) && (seen.add(k.toLowerCase()), true));
}

/** Keywords that match a thread (any keyword matches = the thread matches). */
export function matchingKeywords(t: Thread, wl: Pick<Watchlist, 'keywords' | 'sources'>, text?: string): string[] {
  if (wl.sources.length && !wl.sources.includes(t.source)) return [];
  const fields = { title: t.title, text: [t.excerpt, text].filter(Boolean).join(' '), category: t.category };
  return wl.keywords.filter((k) => {
    // A multi-word keyword is a phrase: "duck canvas" must appear together.
    const q = parseQuery(k.includes(' ') ? `"${k}"` : k);
    return matchFields(fields, q) !== null;
  });
}

export const readToken = (t: Pick<Thread, 'id' | 'lastPostAt'>) => `${t.id}@${t.lastPostAt ?? ''}`;

export function isNewForWatchlist(t: Thread, wl: Watchlist): boolean {
  if (wl.readIds.includes(readToken(t))) return false;
  const activity = t.lastPostAt ?? t.createdAt;
  if (wl.readUntil && activity && activity <= wl.readUntil) return false;
  return true;
}

export interface WatchMatch {
  thread: Thread;
  keywords: string[];
  isNew: boolean;
}

export function watchlistMatches(threads: Thread[], wl: Watchlist): WatchMatch[] {
  const out: WatchMatch[] = [];
  for (const t of threads) {
    const kw = matchingKeywords(t, wl);
    if (kw.length) out.push({ thread: t, keywords: kw, isNew: isNewForWatchlist(t, wl) });
  }
  out.sort((a, b) => (b.thread.lastPostAt ?? '').localeCompare(a.thread.lastPostAt ?? ''));
  return out;
}

export function markWatchlistItemRead(wl: Watchlist, t: Thread): Watchlist {
  const tok = readToken(t);
  // Drop tokens for older activity of the same thread to keep the list short.
  const readIds = wl.readIds.filter((x) => !x.startsWith(`${t.id}@`));
  return { ...wl, readIds: [...readIds, tok] };
}

export function markWatchlistAllRead(wl: Watchlist, threads: Thread[]): Watchlist {
  const latest = threads.reduce((m, t) => ((t.lastPostAt ?? '') > m ? (t.lastPostAt ?? '') : m), wl.readUntil ?? '');
  return { ...wl, readUntil: latest || new Date().toISOString(), readIds: [] };
}
