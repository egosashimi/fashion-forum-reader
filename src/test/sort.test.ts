import { describe, expect, it } from 'vitest';
import { decodeIndexRow, decodeThread } from '../lib/data';
import { categoryKey, dedupeThreads, filterThreads, leaderboardKey, sortThreads } from '../lib/sort';
import type { IndexRow, SourceInfo } from '../lib/types';
import { RAW, THREADS } from './fixtures';

const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe('decoding', () => {
  it('decodes flags', () => {
    const t = decodeThread(RAW[0]);
    expect(t.megathread).toBe(true);
    expect(t.repliesApprox).toBe(true);
    expect(t.viewsApprox).toBe(true);
    expect(t.pinned).toBe(false);
    const p = decodeThread(RAW[2]);
    expect(p.pinned && p.locked).toBe(true);
  });

  it('decodes compact index rows with a URL template', () => {
    const src = { id: 'vlj', baseUrl: 'https://www.vintageleatherjackets.org', threadUrl: '/threads/{id}/', categories: [{ id: 'vintage.7', name: 'Vintage' }] } as unknown as SourceInfo;
    const row: IndexRow = ['20130', 'Maker help', 0, '2019-04-02', '2019-05-01', 21, 3100, 0, 'jim'];
    const t = decodeIndexRow(row, src);
    expect(t.id).toBe('vlj:20130');
    expect(t.url).toBe('https://www.vintageleatherjackets.org/threads/20130/');
    expect(t.category).toBe('Vintage');
    expect(t.createdAt).toBe('2019-04-02T00:00:00Z');
  });
});

describe('sorting', () => {
  it('sorts by most recent activity', () => {
    expect(ids(sortThreads(THREADS, 'updated')).slice(0, 2)).toEqual(['fedoralounge:124285', 'fedoralounge:82949']);
  });
  it('sorts by newest thread', () => {
    expect(ids(sortThreads(THREADS, 'newest'))[0]).toBe('fedoralounge:124285');
    expect(ids(sortThreads(THREADS, 'newest')).at(-1)).toBe('ironheart:934');
  });
  it('sorts by replies and views', () => {
    expect(sortThreads(THREADS, 'replies').map((t) => t.replies)).toEqual([65000, 4599, 21, 15, 8, 3]);
    expect(ids(sortThreads(THREADS, 'views'))[0]).toBe('fedoralounge:82949');
  });
  it('does not mutate input', () => {
    const before = ids(THREADS);
    sortThreads(THREADS, 'replies');
    expect(ids(THREADS)).toEqual(before);
  });
});

describe('filtering', () => {
  it('filters by forums and categories', () => {
    expect(filterThreads(THREADS, { sources: ['ironheart', 'vlj'] }).length).toBe(2);
    expect(ids(filterThreads(THREADS, { categories: [categoryKey('vlj', 'vintage.7')] }))).toEqual(['vlj:20130']);
  });
  it('excludes pinned and megathreads', () => {
    const out = filterThreads(THREADS, { excludePinned: true, excludeMegathreads: true });
    expect(ids(out)).not.toContain('fedoralounge:82949');
    expect(ids(out)).not.toContain('fedoralounge:84057');
  });
  it('filters unread', () => {
    const out = filterThreads(THREADS, { unreadOnly: true, isRead: (t) => t.source === 'fedoralounge' });
    expect(out.every((t) => t.source !== 'fedoralounge')).toBe(true);
  });
});

describe('deduplication', () => {
  it('merges records with the same stable id', () => {
    const a = { ...THREADS[1], replies: 10, excerpt: 'x', lastPostAt: '2026-11-01T00:00:00Z' };
    const b = { ...THREADS[1], replies: 15, excerpt: undefined, lastPostAt: '2026-11-08T00:00:00Z' };
    const out = dedupeThreads([a, b, THREADS[3]]);
    expect(out.length).toBe(2);
    const m = out.find((t) => t.id === a.id)!;
    expect(m.replies).toBe(15);
    expect(m.excerpt).toBe('x');
    expect(m.lastPostAt).toBe('2026-11-08T00:00:00Z');
  });
});

it('builds leaderboard keys matching the collector', () => {
  expect(leaderboardKey('replies', 'all', false)).toBe('replies:all:any');
  expect(leaderboardKey('views', 'week', true, 'vintage.7')).toBe('cat:vintage.7:views:week:clean');
});

describe('post decoding', () => {
  it('maps compact post keys', async () => {
    const { decodePosts } = await import('../lib/data');
    const d = decodePosts({ id: 'ironheart:934', pageCount: 230, pagesIndexed: [1], posts: [{ id: 'ironheart:99022', u: 'https://forum.ironheart.co.uk/post/99022', a: 'Danny RnH', d: '2011-09-02T07:22:28Z', n: 2, e: 'are these VMC 666s sanforized?', pg: 1 }] });
    expect(d.posts[0]).toEqual({ id: 'ironheart:99022', url: 'https://forum.ironheart.co.uk/post/99022', author: 'Danny RnH', postedAt: '2011-09-02T07:22:28Z', position: 2, excerpt: 'are these VMC 666s sanforized?', page: 1 });
  });
});
