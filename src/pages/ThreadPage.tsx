import { useEffect, useState } from 'react';
import { Empty, Notice, SourceBadge } from '../components/Bits';
import { IconBookmark, IconBookmarkFilled, IconExternal } from '../components/Icons';
import { SaveDialog } from '../components/SaveDialog';
import { findThread, loadThreadPosts } from '../lib/data';
import { exactCount, formatDate, formatDateTime, timeAgo } from '../lib/format';
import { postItemId, readState, savedPostFrom, threadItemId, type SavedItem } from '../lib/library';
import type { ForumPost, Thread, ThreadPosts } from '../lib/types';
import { useAppData } from '../state/AppData';
import { useLibrary } from '../state/Library';

export function ThreadPage({ id }: { id: string }) {
  const { manifest, source } = useAppData();
  const { lib, markRead, toggleThread } = useLibrary();
  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [posts, setPosts] = useState<ThreadPosts | null | undefined>(undefined);
  const [pagesShown, setPagesShown] = useState(1);
  const [dialog, setDialog] = useState<SavedItem | null>(null);

  useEffect(() => {
    if (!manifest) return;
    let off = false;
    setThread(undefined);
    setPosts(undefined);
    setPagesShown(1);
    findThread(manifest, id).then((t) => !off && setThread(t ?? null));
    loadThreadPosts(id).then((p) => !off && setPosts(p));
    return () => {
      off = true;
    };
  }, [manifest, id]);

  useEffect(() => {
    if (thread) markRead(thread);
    // only when the thread first loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id]);

  if (!manifest || thread === undefined) return <p className="muted">Loading thread…</p>;
  if (thread === null)
    return (
      <Empty title="Thread not found in the index">
        It may not be indexed yet. <a href="#/feed">Back to the feed</a>
      </Empty>
    );

  const src = source(thread.source);
  const saved = !!lib.items[threadItemId(thread.id)];
  const rs = readState(lib, thread);
  const pages = posts?.pagesIndexed ?? [];
  const visiblePages = pages.slice(0, pagesShown);
  const byPage = new Map<number, ForumPost[]>();
  for (const p of posts?.posts ?? []) if (visiblePages.includes(p.page)) byPage.set(p.page, [...(byPage.get(p.page) ?? []), p]);
  const firstPost = posts?.posts.find((p) => p.position === 1);
  const excerpt = thread.excerpt ?? firstPost?.excerpt;

  return (
    <article className="thread">
      <p className="crumbs">
        <a href="#/feed">← Feed</a>
      </p>
      <header className="thread__head">
        <h1>{thread.title}</h1>
        <div className="row__meta">
          <SourceBadge id={thread.source} />
          <span>{thread.category}</span>
          {thread.author && <span>started by {thread.author}</span>}
          <span>{formatDate(thread.createdAt)}</span>
        </div>
        <dl className="facts">
          <div>
            <dt>Replies</dt>
            <dd>{exactCount(thread.replies, thread.repliesApprox)}</dd>
          </div>
          <div>
            <dt>Views</dt>
            <dd>{thread.views !== undefined ? exactCount(thread.views, thread.viewsApprox) : 'not reported'}</dd>
          </div>
          <div>
            <dt>Last activity</dt>
            <dd title={formatDateTime(thread.lastPostAt)}>{timeAgo(thread.lastPostAt)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{[thread.pinned && 'pinned', thread.locked && 'locked', thread.megathread && 'megathread', rs].filter(Boolean).join(', ')}</dd>
          </div>
        </dl>
        <div className="thread__actions">
          <a className="btn btn--primary btn--big" href={thread.url} target="_blank" rel="noopener noreferrer">
            Read the full discussion on {src?.name ?? 'the forum'} <IconExternal />
          </a>
          <button type="button" className={`btn${saved ? ' on' : ''}`} onClick={() => toggleThread(thread)} aria-pressed={saved}>
            {saved ? <IconBookmarkFilled /> : <IconBookmark />} {saved ? 'Saved' : 'Save thread'}
          </button>
          {saved && (
            <button type="button" className="btn" onClick={() => setDialog(lib.items[threadItemId(thread.id)])}>
              Tags &amp; notes
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => markRead(thread, rs === 'unread')}>
            Mark {rs === 'unread' ? 'read' : 'unread'}
          </button>
        </div>
      </header>

      {excerpt && (
        <section>
          <h2>Opening post (excerpt)</h2>
          <blockquote className="quote">{excerpt}</blockquote>
        </section>
      )}

      <section>
        <h2>Indexed posts</h2>
        {posts === undefined && <p className="muted">Loading posts…</p>}
        {posts === null && (
          <Notice kind="info">
            Posts in this thread have not been indexed yet. The collector indexes the first pages of popular and recently active threads a few at a time.
            You can still <a href={thread.url} target="_blank" rel="noopener noreferrer">read it on the forum</a> or save a post by its link in the
            Library.
          </Notice>
        )}
        {posts && (
          <>
            <Notice kind="info">
              This shows short excerpts of {posts.posts.length} indexed posts from page{pages.length > 1 ? 's' : ''} {pages.join(', ')}
              {posts.pageCount ? ` of ${posts.pageCount}` : ''}. Full posts, images and the rest of the thread are on the original forum.
            </Notice>
            {[...byPage.entries()].map(([page, list]) => (
              <div key={page} className="postpage">
                <h3 className="muted small">
                  Page {page}
                  {posts.pageCount ? ` of ${posts.pageCount}` : ''}
                </h3>
                <ol className="posts">
                  {list.map((p) => {
                    const pid = postItemId(p.id);
                    const isSaved = !!lib.items[pid];
                    return (
                      <li key={p.id} className="post">
                        <div className="post__meta">
                          {p.position && <span className="post__n">#{p.position}</span>}
                          <strong>{p.author ?? 'unknown'}</strong>
                          <span title={formatDateTime(p.postedAt)}>{formatDate(p.postedAt)}</span>
                          <a href={p.url} target="_blank" rel="noopener noreferrer">
                            Permalink <IconExternal />
                          </a>
                        </div>
                        <p className="post__text">{p.excerpt || <em className="muted">(no text: images or quotes only)</em>}</p>
                        <button type="button" className={`btn btn--small${isSaved ? ' on' : ''}`} onClick={() => setDialog(lib.items[pid] ?? savedPostFrom(p, thread))}>
                          {isSaved ? <IconBookmarkFilled /> : <IconBookmark />} {isSaved ? 'Saved post' : 'Save post'}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
            {pagesShown < pages.length && (
              <button type="button" className="btn more" onClick={() => setPagesShown(pagesShown + 1)}>
                Show indexed page {pages[pagesShown]}
              </button>
            )}
            {posts.pageCount && pages.length < posts.pageCount && (
              <p className="muted small">
                Pages not indexed: {posts.pageCount - pages.length}.{' '}
                <a href={thread.url} target="_blank" rel="noopener noreferrer">
                  Continue on the forum
                </a>
                .
              </p>
            )}
          </>
        )}
      </section>
      {dialog && <SaveDialog item={dialog} onClose={() => setDialog(null)} title={dialog.kind === 'post' ? 'Save post' : undefined} />}
      <SaveThreadShortcut thread={thread} />
    </article>
  );
}

/** Keyboard shortcut: "s" toggles saving the open thread. */
function SaveThreadShortcut({ thread }: { thread: Thread }) {
  const { toggleThread } = useLibrary();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) toggleThread(thread);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [thread, toggleThread]);
  return null;
}

