import { useMemo, useRef, useState } from 'react';
import { Empty, Notice, Segmented } from '../components/Bits';
import { SelectField } from '../components/Filters';
import { SavedItemCard } from '../components/SavedItemCard';
import {
  addCollection, allTags, exportLibrary, importLibrary, manualPost, queryLibrary, removeCollection, validatePermalink,
  type LibraryQuery,
} from '../lib/library';
import { href, navigate, useRoute } from '../lib/router';
import { parseQuery } from '../lib/search';
import { useAppData } from '../state/AppData';
import { useLibrary } from '../state/Library';

type Tab = 'threads' | 'posts' | 'collections' | 'backup';

function ManualPostForm({ onDone }: { onDone: () => void }) {
  const { putItem, lib } = useLibrary();
  const { manifest, sourceForUrl } = useAppData();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tags, setTags] = useState('');
  const [col, setCol] = useState('');
  const err = url ? validatePermalink(url) : null;
  const detected = url && !err ? sourceForUrl(url) : undefined;
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url || err) return;
        putItem(manualPost({ url, title, author, notes, excerpt, publishedAt: date ? new Date(date).toISOString() : undefined, tags: tags.split(','), collections: col ? [col] : [] }, sourceForUrl));
        onDone();
      }}
    >
      <h2>Save a post by link</h2>
      <p className="muted small">
        For posts the app has not indexed, or forums it does not cover. On most forums, the post number or “Share” button gives a link to the exact post.
      </p>
      <label className="field">
        <span>Post permalink *</span>
        <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.thefedoralounge.com/threads/…/post-123456" aria-invalid={!!err} />
        {err && <small className="error">{err}</small>}
        {detected && <small className="muted">Forum: {manifest?.sources.find((s) => s.id === detected)?.name}</small>}
      </label>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Walls Blizzard-Pruf label dating" />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="field">
          <span>Posted on</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Your own excerpt or summary</span>
        <textarea rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Tags</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Walls, labels" />
        </label>
        <label className="field">
          <span>Collection</span>
          <select value={col} onChange={(e) => setCol(e.target.value)}>
            <option value="">None</option>
            {Object.values(lib.collections).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dialog__foot">
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={!url || !!err}>
          Save post
        </button>
      </div>
    </form>
  );
}

function ItemsView({ kind }: { kind: 'thread' | 'post' }) {
  const { lib } = useLibrary();
  const { manifest } = useAppData();
  const route = useRoute();
  const [text, setText] = useState('');
  const [read, setRead] = useState<'' | 'read' | 'unread'>('');
  const [sort, setSort] = useState<NonNullable<LibraryQuery['sort']>>('saved');
  const [adding, setAdding] = useState(false);
  const tag = route.params.get('tag') ?? '';
  const collection = route.params.get('collection') ?? '';
  const source = route.params.get('source') ?? '';
  const setParam = (k: string, v: string) => {
    const p = Object.fromEntries(route.params);
    navigate(['library', kind === 'post' ? 'posts' : 'threads'], { ...p, [k]: v || undefined }, true);
  };
  const items = useMemo(() => queryLibrary(lib, { kind, text, tag: tag || undefined, collection: collection || undefined, source: source || undefined, read: read || undefined, sort }), [lib, kind, text, tag, collection, source, read, sort]);
  const tags = allTags({ ...lib, items: Object.fromEntries(Object.entries(lib.items).filter(([, i]) => i.kind === kind)) });
  const parsed = useMemo(() => (text ? parseQuery(text) : null), [text]);

  return (
    <>
      {kind === 'post' && (adding ? <ManualPostForm onDone={() => setAdding(false)} /> : (
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          + Save a post by link
        </button>
      ))}
      <div className="toolbar">
        <input type="search" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search saved ${kind}s, tags and notes`} aria-label="Search library" />
        <div className="toolbar__row">
          <label className="field field--inline">
            <span>Tag</span>
            <select value={tag} onChange={(e) => setParam('tag', e.target.value)}>
              <option value="">Any</option>
              {tags.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span>Collection</span>
            <select value={collection} onChange={(e) => setParam('collection', e.target.value)}>
              <option value="">Any</option>
              {Object.values(lib.collections).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span>Forum</span>
            <select value={source} onChange={(e) => setParam('source', e.target.value)}>
              <option value="">Any</option>
              {manifest?.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.short}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </label>
          <SelectField label="Status" value={read} onChange={setRead} options={[{ value: '', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'read', label: 'Read' }]} />
          <SelectField
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'saved', label: 'Recently saved' },
              { value: 'published', label: 'Published (newest)' },
              { value: 'published-asc', label: 'Published (oldest)' },
              { value: 'title', label: 'Title A–Z' },
            ]}
          />
        </div>
      </div>
      <p className="count muted">{items.length} saved {kind}{items.length === 1 ? '' : 's'}</p>
      {items.length === 0 ? (
        <Empty title={`No saved ${kind}s${tag || collection || text ? ' match' : ' yet'}`}>
          {kind === 'thread' ? 'Use the bookmark icon on any thread to save it.' : 'Open a thread and use “Save post” on any indexed reply, or save one by link.'}
        </Empty>
      ) : (
        <div className="list">
          {items.map((it) => (
            <SavedItemCard key={it.id} item={it} query={parsed} />
          ))}
        </div>
      )}
    </>
  );
}

function CollectionsView() {
  const { lib, update } = useLibrary();
  const [name, setName] = useState('');
  const cols = Object.values(lib.collections).sort((a, b) => a.name.localeCompare(b.name));
  const count = (id: string, kind: 'thread' | 'post') => Object.values(lib.items).filter((i) => i.kind === kind && i.collections.includes(id)).length;
  return (
    <>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) update((l) => addCollection(l, name)[0]);
          setName('');
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection, e.g. Military" aria-label="New collection name" />
        <button className="btn btn--primary" type="submit">
          Create
        </button>
      </form>
      {cols.length === 0 ? (
        <Empty title="No collections">Collections group saved threads and posts by subject.</Empty>
      ) : (
        <ul className="collections">
          {cols.map((c) => (
            <li key={c.id} className="card">
              <strong>{c.name}</strong>
              <span className="muted small">
                <a href={href(['library', 'threads'], { collection: c.id })}>{count(c.id, 'thread')} threads</a> ·{' '}
                <a href={href(['library', 'posts'], { collection: c.id })}>{count(c.id, 'post')} posts</a>
              </span>
              <button type="button" className="btn btn--tiny btn--danger" onClick={() => confirm(`Delete collection “${c.name}”? Saved items stay in your library.`) && update((l) => removeCollection(l, c.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BackupView() {
  const { lib, replaceAll, persistError } = useLibrary();
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const counts = { threads: Object.values(lib.items).filter((i) => i.kind === 'thread').length, posts: Object.values(lib.items).filter((i) => i.kind === 'post').length };

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportLibrary(lib), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vintage-forum-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const doImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const [next, report] = importLibrary(lib, data);
      replaceAll(next);
      setMsg({ kind: 'info', text: `Imported ${report.items} items, ${report.collections} collections and ${report.watchlists} watchlists${report.skipped ? `; skipped ${report.skipped} invalid entries` : ''}.` });
    } catch (e) {
      setMsg({ kind: 'error', text: `Import failed: ${(e as Error).message}` });
    }
  };

  return (
    <div className="card prose">
      <h2>Backup &amp; restore</h2>
      <p>
        Your library is stored <strong>only in this browser</strong>, in IndexedDB on this device. Right now that is {counts.threads} threads, {counts.posts} posts,{' '}
        {Object.keys(lib.collections).length} collections and {Object.keys(lib.watchlists).length} watchlists.
      </p>
      <Notice kind="warn">
        Bookmarks do <strong>not</strong> sync between devices or browsers. Syncing would need an extra service, such as an account server or a cloud drive. To
        move your library, export it here and import the file on the other device. Clearing site data or using private browsing deletes the library, so export
        regularly.
      </Notice>
      {persistError && <Notice kind="error">{persistError}</Notice>}
      <div className="inline">
        <button type="button" className="btn btn--primary" onClick={doExport}>
          Export library (JSON)
        </button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          Import from file…
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
      </div>
      <p className="muted small">An import merges into your current library: matching items keep your notes, and tags and collections are combined. Nothing is deleted.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}

export function LibraryPage({ tab }: { tab?: string }) {
  const current: Tab = (['threads', 'posts', 'collections', 'backup'] as Tab[]).includes(tab as Tab) ? (tab as Tab) : 'threads';
  const { lib, ready } = useLibrary();
  const n = (k: 'thread' | 'post') => Object.values(lib.items).filter((i) => i.kind === k).length;
  return (
    <section>
      <header className="page-head">
        <h1>Library</h1>
        <p className="muted">Your research library: saved threads, saved posts, tags, notes and collections.</p>
      </header>
      <Segmented
        label="Library section"
        value={current}
        onChange={(v) => navigate(['library', v])}
        options={[
          { value: 'threads', label: `Threads (${n('thread')})` },
          { value: 'posts', label: `Posts (${n('post')})` },
          { value: 'collections', label: 'Collections' },
          { value: 'backup', label: 'Backup' },
        ]}
      />
      {!ready ? <p className="muted">Opening library…</p> : current === 'threads' ? <ItemsView key="t" kind="thread" /> : current === 'posts' ? <ItemsView key="p" kind="post" /> : current === 'collections' ? <CollectionsView /> : <BackupView />}
    </section>
  );
}
