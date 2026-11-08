import { useMemo, useState } from 'react';
import { Empty, Notice } from '../components/Bits';
import { CategorySelect, SelectField, SourcePicker, Toggle } from '../components/Filters';
import { ThreadRow } from '../components/ThreadRow';
import { readState } from '../lib/library';
import { usePref } from '../lib/router';
import { categoryKey, filterThreads, sortThreads } from '../lib/sort';
import type { FeedSort } from '../lib/types';
import { useAppData } from '../state/AppData';
import { useLibrary } from '../state/Library';

const PAGE = 40;

export function FeedPage() {
  const { manifest, feed, feedDays } = useAppData();
  const { lib, update } = useLibrary();
  const [sources, setSources] = usePref<string[]>('feed.sources', []);
  const [category, setCategory] = usePref<string>('feed.category', '');
  const [sort, setSort] = usePref<FeedSort>('feed.sort', 'updated');
  const [unreadOnly, setUnreadOnly] = usePref('feed.unread', false);
  const [hidePinned, setHidePinned] = usePref('feed.hidePinned', false);
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of feed) m.set(categoryKey(t.source, t.categoryId), (m.get(categoryKey(t.source, t.categoryId)) ?? 0) + 1);
    return m;
  }, [feed]);

  const threads = useMemo(() => {
    const f = filterThreads(feed, {
      sources,
      categories: category ? [category] : [],
      excludePinned: hidePinned,
      unreadOnly,
      isRead: (t) => readState(lib, t) === 'read',
    });
    return sortThreads(f, sort);
  }, [feed, sources, category, sort, unreadOnly, hidePinned, lib]);

  if (!manifest) return null;
  const unavailable = manifest.sources.filter((s) => s.status === 'blocked' || s.status === 'error' || s.status === 'pending');

  const markAllRead = () =>
    update((l) => {
      const read = { ...l.read };
      const now = new Date().toISOString();
      for (const t of threads) read[t.id] = { at: now, lastPostAt: t.lastPostAt };
      return { ...l, read };
    });

  return (
    <section>
      <header className="page-head">
        <h1>Feed</h1>
        <p className="muted">
          New and recently updated discussions from the last {feedDays} days across {manifest.sources.length} forums. For older threads use{' '}
          <a href="#/best">Best of All Time</a> or <a href="#/search">Search</a>, which cover the historical index.
        </p>
      </header>
      {unavailable.length > 0 && (
        <Notice kind="warn">
          Not in the latest update: {unavailable.map((s) => `${s.short} (${s.status})`).join(', ')}. See <a href="#/sources">Sources</a>.
        </Notice>
      )}
      <div className="toolbar">
        <SourcePicker sources={manifest.sources} selected={sources} onChange={(s) => { setSources(s); setCategory(''); setLimit(PAGE); }} />
        <div className="toolbar__row">
          <CategorySelect sources={manifest.sources} selectedSources={sources} value={category} onChange={(c) => { setCategory(c); setLimit(PAGE); }} counts={counts} />
          <SelectField
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'updated', label: 'Recently updated' },
              { value: 'newest', label: 'Newest threads' },
              { value: 'replies', label: 'Most replies' },
              { value: 'views', label: 'Most views' },
            ]}
          />
          <Toggle label="Unread only" checked={unreadOnly} onChange={setUnreadOnly} />
          <Toggle label="Hide pinned" checked={hidePinned} onChange={setHidePinned} />
          <button type="button" className="btn btn--ghost" onClick={markAllRead} disabled={!threads.length}>
            Mark shown as read
          </button>
        </div>
      </div>
      <p className="count muted">{threads.length.toLocaleString()} threads</p>
      {threads.length === 0 ? (
        <Empty title="Nothing here">Try other forums or turn off “Unread only”.</Empty>
      ) : (
        <div className="list">
          {threads.slice(0, limit).map((t) => (
            <ThreadRow key={t.id} thread={t} />
          ))}
        </div>
      )}
      {threads.length > limit && (
        <button type="button" className="btn more" onClick={() => setLimit(limit + PAGE * 2)}>
          Show more ({(threads.length - limit).toLocaleString()} left)
        </button>
      )}
    </section>
  );
}
