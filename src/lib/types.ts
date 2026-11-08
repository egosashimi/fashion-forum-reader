// Shapes of the static JSON written by `python -m collector build`.

export type SourceStatus = 'ok' | 'partial' | 'error' | 'blocked' | 'pending';

export interface CategoryCoverage {
  id: string;
  name: string;
  indexed: number;
  estimated: number;
  estimateExact: boolean;
  backfillDone: boolean;
}

export interface SourceInfo {
  id: string;
  name: string;
  short: string;
  adapter: string;
  homepage: string;
  baseUrl: string;
  color: string;
  notes?: string;
  threadUrl: string; // e.g. "/threads/{id}/"
  status: SourceStatus;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastRun?: { at: string; requests: number; new_threads: number; updated_threads: number; new_posts: number } | null;
  postsIndexedThreads: number;
  postsIndexed: number;
  categories: CategoryCoverage[];
  indexed: number;
  estimated: number;
  coverage: number; // 0..1
  backfillComplete: boolean;
  backfillPagesWalked: number;
  backfillCycle: number;
  topRefreshedAt?: string | null;
}

export interface ChunkRef {
  source: string;
  file: string;
  count: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  historicalComplete: boolean;
  totals: { threads: number; posts: number; feed: number };
  sources: SourceInfo[];
  index: ChunkRef[];
  text: ChunkRef[];
  flags: { pinned: number; megathread: number; repliesApprox: number; viewsApprox: number; locked: number };
}

/** Compact thread record as stored in feed.json / leaderboards. */
export interface RawThread {
  id: string;
  s: string;
  t: string;
  u: string;
  c: string;
  ci: string;
  a?: string;
  ca?: string;
  la?: string;
  r?: number;
  v?: number;
  f?: number;
  e?: string;
  pp?: number;
}

/** Search index row: [threadId, title, categoryIndex, created, lastPost, replies, views, flags, author]. */
export type IndexRow = [string, string, number, string | null, string | null, number | null, number | null, number, string | null];

export interface Thread {
  id: string; // "<source>:<thread id>"
  source: string;
  title: string;
  url: string;
  category: string;
  categoryId: string;
  author?: string;
  createdAt?: string;
  lastPostAt?: string;
  replies?: number;
  views?: number;
  pinned: boolean;
  megathread: boolean;
  locked: boolean;
  repliesApprox: boolean;
  viewsApprox: boolean;
  excerpt?: string;
  postPages?: number;
}

export interface ForumPost {
  id: string;
  url: string;
  author?: string;
  postedAt?: string;
  position?: number;
  excerpt: string;
  page: number;
}

export interface ThreadPosts {
  id: string;
  pageCount?: number | null;
  pagesIndexed: number[];
  posts: ForumPost[];
}

export interface Leaderboard {
  scope: string;
  generatedAt: string;
  lists: Record<string, string[]>;
  threads: Record<string, RawThread>;
}

export type FeedSort = 'updated' | 'newest' | 'replies' | 'views';
export type SearchSort = 'relevance' | 'newest' | 'replies' | 'oldest';
export type Metric = 'replies' | 'views';
export type TimeWindow = 'all' | 'year' | 'month' | 'week';
