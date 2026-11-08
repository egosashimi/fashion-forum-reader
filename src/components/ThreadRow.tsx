import { memo } from 'react';
import { exactCount, formatCount, formatDate, timeAgo } from '../lib/format';
import { readState, threadItemId } from '../lib/library';
import { href } from '../lib/router';
import type { ParsedQuery } from '../lib/search';
import type { Thread } from '../lib/types';
import { useLibrary } from '../state/Library';
import { Highlight, SourceBadge } from './Bits';
import { IconBookmark, IconBookmarkFilled, IconExternal, IconLock, IconPin, IconReplies, IconViews } from './Icons';

interface Props {
  thread: Thread;
  rank?: number;
  query?: ParsedQuery | null;
  snippet?: string;
  showExcerpt?: boolean;
  extra?: React.ReactNode;
  highlightNew?: boolean;
}

export const ThreadRow = memo(function ThreadRow({ thread: t, rank, query, snippet, showExcerpt = true, extra, highlightNew }: Props) {
  const { lib, toggleThread, markRead } = useLibrary();
  const saved = !!lib.items[threadItemId(t.id)];
  const rs = readState(lib, t);
  const text = snippet ?? (showExcerpt ? t.excerpt : undefined);
  return (
    <article className={`row${rs === 'read' ? ' row--read' : ''}${highlightNew ? ' row--new' : ''}`}>
      {rank !== undefined && <div className="row__rank">{rank}</div>}
      <div className="row__main">
        <h3 className="row__title">
          {rs !== 'read' && <span className={`dot dot--${rs}`} title={rs === 'updated' ? 'New replies since you read it' : 'Unread'} />}
          <a href={href(['thread', t.id])} onClick={() => markRead(t)}>
            <Highlight text={t.title} query={query} />
          </a>
        </h3>
        <div className="row__meta">
          <SourceBadge id={t.source} />
          <span className="row__cat">{t.category}</span>
          {t.author && (
            <span>
              by <Highlight text={t.author} query={query} />
            </span>
          )}
          {t.createdAt && <span title={`Started ${formatDate(t.createdAt)}`}>started {formatDate(t.createdAt)}</span>}
          {t.lastPostAt && <span title={`Last activity ${t.lastPostAt}`}>active {timeAgo(t.lastPostAt)}</span>}
        </div>
        {text && (
          <p className="row__excerpt">
            <Highlight text={text} query={query} />
          </p>
        )}
        <div className="row__stats">
          <span title={`${exactCount(t.replies, t.repliesApprox)} replies`}>
            <IconReplies /> {formatCount(t.replies, t.repliesApprox)}
          </span>
          {t.views !== undefined && (
            <span title={`${exactCount(t.views, t.viewsApprox)} views`}>
              <IconViews /> {formatCount(t.views, t.viewsApprox)}
            </span>
          )}
          {t.pinned && (
            <span className="tag" title="Pinned / sticky on the forum">
              <IconPin /> pinned
            </span>
          )}
          {t.megathread && <span className="tag" title="Long-running general / picture thread">megathread</span>}
          {t.locked && (
            <span className="tag" title="Locked">
              <IconLock />
            </span>
          )}
          {extra}
          <a className="row__orig" href={t.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead(t)}>
            Original <IconExternal />
          </a>
        </div>
      </div>
      <button
        type="button"
        className={`iconbtn row__save${saved ? ' on' : ''}`}
        onClick={() => toggleThread(t)}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from library' : 'Save thread to library'}
        title={saved ? 'Saved — click to remove' : 'Save thread'}
      >
        {saved ? <IconBookmarkFilled /> : <IconBookmark />}
      </button>
    </article>
  );
});
