import { useEffect, useMemo, useState } from 'react';
import { Chip, Empty, Notice, Segmented } from '../components/Bits';
import { CoverageTable } from '../components/Coverage';
import { Toggle } from '../components/Filters';
import { ThreadRow } from '../components/ThreadRow';
import { loadLeaderboard } from '../lib/data';
import { formatDate, pct } from '../lib/format';
import { usePref } from '../lib/router';
import { leaderboardKey } from '../lib/sort';
import type { Metric, Thread, TimeWindow } from '../lib/types';
import { useAppData } from '../state/AppData';

type Board = Awaited<ReturnType<typeof loadLeaderboard>>;

const WINDOW_LABEL: Record<TimeWindow, string> = { all: 'All Time', year: 'Last Year', month: 'Last Month', week: 'Last Week' };

export function BestPage() {
  const { manifest } = useAppData();
  const [metric, setMetric] = usePref<Metric>('best.metric', 'replies');
  const [scope, setScope] = usePref<string>('best.scope', 'all');
  const [category, setCategory] = usePref<string>('best.category', '');
  const [window, setWindow] = usePref<TimeWindow>('best.window', 'all');
  const [clean, setClean] = usePref('best.clean', false);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validScope = scope === 'all' || manifest?.sources.some((s) => s.id === scope) ? scope : 'all';
  useEffect(() => {
    let off = false;
    setBoard(null);
    setError(null);
    loadLeaderboard(validScope)
      .then((b) => !off && setBoard(b))
      .catch((e: Error) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [validScope]);

  const source = manifest?.sources.find((s) => s.id === validScope);
  const key = leaderboardKey(metric, window, clean, validScope !== 'all' && category ? category : undefined);
  const rows: Thread[] = useMemo(() => (board?.lists[key] ?? []).map((id) => board!.threads.get(id)!).filter(Boolean), [board, key]);

  if (!manifest) return null;
  const scoped = source ? [source] : manifest.sources;
  const complete = scoped.every((s) => s.backfillComplete && s.coverage >= 0.95 && s.status !== 'blocked');
  const indexed = scoped.reduce((n, s) => n + s.indexed, 0);
  const estimated = scoped.reduce((n, s) => n + s.estimated, 0);
  const title = `${metric === 'replies' ? 'Most Replied' : 'Most Viewed'} — ${complete ? WINDOW_LABEL[window] : `Indexed Threads${window !== 'all' ? ` · ${WINDOW_LABEL[window]}` : ''}`}`;
  const rounded = rows.some((t) => (metric === 'replies' ? t.repliesApprox : t.viewsApprox));

  return (
    <section>
      <header className="page-head">
        <h1>Best of All Time</h1>
        <p className="muted">
          The most active discussions in each forum's archive, ranked by reply count (or views). Long-forgotten threads with deep research
          tend to surface here.
        </p>
      </header>

      <div className="toolbar">
        <Segmented label="Rank by" value={metric} onChange={setMetric} options={[{ value: 'replies', label: 'Most replied' }, { value: 'views', label: 'Most viewed' }]} />
        <div className="chips" role="group" aria-label="Forum">
          <Chip active={validScope === 'all'} onClick={() => { setScope('all'); setCategory(''); }}>
            All forums
          </Chip>
          {manifest.sources.map((s) => (
            <Chip key={s.id} active={validScope === s.id} onClick={() => { setScope(s.id); setCategory(''); }} title={s.name}>
              <span className="swatch" style={{ background: s.color }} />
              {s.short}
            </Chip>
          ))}
        </div>
        <div className="toolbar__row">
          {source && (
            <label className="field field--inline">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All of {source.short}</option>
                {source.categories
                  .filter((c) => c.indexed > 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.indexed.toLocaleString()})
                    </option>
                  ))}
              </select>
            </label>
          )}
          <Segmented label="Time" value={window} onChange={setWindow} options={(Object.keys(WINDOW_LABEL) as TimeWindow[]).map((w) => ({ value: w, label: WINDOW_LABEL[w] }))} />
          <Toggle label="Exclude pinned & megathreads" checked={clean} onChange={setClean} title="Hide sticky threads and long-running general / picture threads such as “What are you wearing today”" />
        </div>
      </div>

      <h2 className="board-title">{title}</h2>
      {!complete ? (
        <Notice kind="info">
          <strong>Historical coverage is incomplete.</strong> This ranking covers {indexed.toLocaleString()} indexed threads out of an estimated{' '}
          {estimated.toLocaleString()} ({pct(estimated ? indexed / estimated : 0)}). The backfill indexes older threads a little at a time, every
          few hours. The top of each forum's list is checked against the forum's own “most replies / most views” sort, so the biggest threads
          appear before the backfill finishes.
        </Notice>
      ) : null}
      {window !== 'all' && <p className="muted small">Time filters use the date a thread was started.</p>}
      {rounded && (
        <p className="muted small">
          Counts marked ~ were shown rounded by the forum (e.g. “65K”). They are replaced with exact figures when a feed or API reports them.
        </p>
      )}

      {error && <Notice kind="error">Could not load leaderboard: {error}</Notice>}
      {!board && !error && <p className="muted">Loading…</p>}
      {board && rows.length === 0 && <Empty title="No threads for this combination yet">Try a longer time range or another forum.</Empty>}
      <ol className="list list--ranked">
        {rows.slice(0, 100).map((t, i) => (
          <li key={t.id}>
            <ThreadRow thread={t} rank={i + 1} showExcerpt={false} />
          </li>
        ))}
      </ol>
      {board && <p className="muted small">Leaderboards generated {formatDate(board.generatedAt)}.</p>}

      <h2>Indexing coverage</h2>
      <CoverageTable manifest={manifest} />
      <p className="muted small">
        <a href="#/sources">Source details</a>: per-category coverage, update times and access notes.
      </p>
    </section>
  );
}
