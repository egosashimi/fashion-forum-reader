import { useMemo, useState } from 'react';
import { Chip, Empty, Notice } from '../components/Bits';
import { SourcePicker, Toggle } from '../components/Filters';
import { ThreadRow } from '../components/ThreadRow';
import { nowIso, uid, type Watchlist } from '../lib/library';
import { href, usePref } from '../lib/router';
import { parseQuery } from '../lib/search';
import { markWatchlistAllRead, markWatchlistItemRead, parseKeywords, watchlistMatches } from '../lib/watchlist';
import { useAppData } from '../state/AppData';
import { useLibrary } from '../state/Library';

const EXAMPLES = ['Walls', 'Kakadu', 'vintage workwear', 'duck canvas', 'military surplus'];

function WatchlistForm({ initial, onDone }: { initial?: Watchlist; onDone: () => void }) {
  const { manifest } = useAppData();
  const { saveWatchlist } = useLibrary();
  const [name, setName] = useState(initial?.name ?? '');
  const [keywords, setKeywords] = useState(initial?.keywords.join(', ') ?? '');
  const [sources, setSources] = useState<string[]>(initial?.sources ?? []);
  const kws = parseKeywords(keywords);
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!kws.length) return;
        saveWatchlist({
          id: initial?.id ?? uid('wl_'),
          name: name.trim() || kws.slice(0, 3).join(', '),
          keywords: kws,
          sources,
          createdAt: initial?.createdAt ?? nowIso(),
          readUntil: initial?.readUntil,
          readIds: initial?.readIds ?? [],
        });
        onDone();
      }}
    >
      <h2>{initial ? 'Edit watchlist' : 'New watchlist'}</h2>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workwear brands" />
      </label>
      <label className="field">
        <span>Keywords: separate with commas. A multi-word keyword is matched as a phrase.</span>
        <textarea rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={EXAMPLES.join(', ')} required />
      </label>
      {!keywords && (
        <div className="chips">
          {EXAMPLES.map((k) => (
            <Chip key={k} onClick={() => setKeywords(keywords ? `${keywords}, ${k}` : k)}>
              + {k}
            </Chip>
          ))}
        </div>
      )}
      <div className="field">
        <span>Forums (none selected = all)</span>
        {manifest && <SourcePicker sources={manifest.sources} selected={sources} onChange={setSources} />}
      </div>
      <div className="dialog__foot">
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={!kws.length}>
          Save watchlist
        </button>
      </div>
    </form>
  );
}

export function WatchlistPage() {
  const { feed, feedDays } = useAppData();
  const { lib, saveWatchlist, removeWatchlist } = useLibrary();
  const lists = Object.values(lib.watchlists).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [selected, setSelected] = usePref<string>('watch.selected', '');
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [newOnly, setNewOnly] = usePref('watch.newOnly', false);

  const matchesBy = useMemo(() => new Map(lists.map((w) => [w.id, watchlistMatches(feed, w)])), [lists, feed]);
  const current = lists.find((w) => w.id === selected) ?? lists[0];
  const matches = current ? (matchesBy.get(current.id) ?? []) : [];
  const shown = newOnly ? matches.filter((m) => m.isNew) : matches;
  const hl = useMemo(() => (current ? parseQuery(current.keywords.map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' ')) : null), [current]);

  return (
    <section>
      <header className="page-head">
        <h1>Watchlist</h1>
        <p className="muted">
          Follow brands and subjects. Threads active in the last {feedDays} days that match a keyword in the title or opening post show up here. To
          look through older threads, use <a href="#/search">Search</a>.
        </p>
      </header>

      {editing && <WatchlistForm initial={editing === 'new' ? undefined : lib.watchlists[editing]} onDone={() => setEditing(null)} />}

      {lists.length === 0 && !editing ? (
        <Empty title="No watchlists yet">
          <p>Create one for brands like Walls or Kakadu, or subjects like duck canvas or military surplus.</p>
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            Create a watchlist
          </button>
        </Empty>
      ) : (
        <>
          <div className="chips" role="tablist" aria-label="Watchlists">
            {lists.map((w) => {
              const n = matchesBy.get(w.id)?.filter((m) => m.isNew).length ?? 0;
              return (
                <Chip key={w.id} active={current?.id === w.id} onClick={() => setSelected(w.id)}>
                  {w.name}
                  {n > 0 && <span className="count-badge">{n}</span>}
                </Chip>
              );
            })}
            <Chip onClick={() => setEditing('new')}>+ New</Chip>
          </div>
          {current && (
            <>
              <div className="toolbar__row watch-actions">
                <span className="muted small">
                  Keywords: {current.keywords.map((k) => <a key={k} className="tag" href={href('search', { q: k.includes(' ') ? `"${k}"` : k })}>{k}</a>)}
                  {current.sources.length > 0 && ` · in ${current.sources.join(', ')}`}
                </span>
                <Toggle label="New only" checked={newOnly} onChange={setNewOnly} />
                <button type="button" className="btn btn--small" onClick={() => saveWatchlist(markWatchlistAllRead(current, matches.map((m) => m.thread)))} disabled={!matches.some((m) => m.isNew)}>
                  Mark all read
                </button>
                <button type="button" className="btn btn--small" onClick={() => setEditing(current.id)}>
                  Edit
                </button>
                <button type="button" className="btn btn--small btn--danger" onClick={() => confirm(`Delete watchlist “${current.name}”?`) && removeWatchlist(current.id)}>
                  Delete
                </button>
              </div>
              <p className="count muted">
                {matches.filter((m) => m.isNew).length} new of {matches.length} matching threads
              </p>
              {shown.length === 0 ? (
                <Empty title={matches.length ? 'All caught up' : 'No recent matches'}>{matches.length ? 'Nothing new since you last marked this list read.' : 'Nothing in the recent feed matches these keywords yet.'}</Empty>
              ) : (
                <div className="list">
                  {shown.map((m) => (
                    <ThreadRow
                      key={m.thread.id}
                      thread={m.thread}
                      query={hl}
                      highlightNew={m.isNew}
                      extra={
                        <>
                          {m.keywords.map((k) => (
                            <span key={k} className="tag tag--match">
                              {k}
                            </span>
                          ))}
                          {m.isNew && (
                            <button type="button" className="btn btn--tiny" onClick={() => saveWatchlist(markWatchlistItemRead(current, m.thread))}>
                              Mark read
                            </button>
                          )}
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <Notice kind="info">Watchlists are checked when you open the app. There are no push notifications.</Notice>
    </section>
  );
}
