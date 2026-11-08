import { useState } from 'react';
import { formatDate } from '../lib/format';
import { removeItem, updateItem, type SavedItem } from '../lib/library';
import { href } from '../lib/router';
import type { ParsedQuery } from '../lib/search';
import { useLibrary } from '../state/Library';
import { Highlight, SourceBadge } from './Bits';
import { IconCheck, IconEdit, IconExternal } from './Icons';
import { SaveDialog } from './SaveDialog';

export function SavedItemCard({ item, query }: { item: SavedItem; query?: ParsedQuery | null }) {
  const { lib, update } = useLibrary();
  const [editing, setEditing] = useState(false);
  const cols = item.collections.map((c) => lib.collections[c]?.name).filter(Boolean);
  return (
    <article className={`row saved${item.read ? ' row--read' : ''}`}>
      <div className="row__main">
        <h3 className="row__title">
          {!item.read && <span className="dot dot--unread" title="Unread" />}
          <span className="kind">{item.kind === 'post' ? (item.manual ? 'Post (manual)' : 'Post') : 'Thread'}</span>
          {item.kind === 'thread' ? (
            <a href={href(['thread', item.threadId])}>
              <Highlight text={item.title} query={query} />
            </a>
          ) : (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <Highlight text={item.title} query={query} />
            </a>
          )}
        </h3>
        <div className="row__meta">
          <SourceBadge id={item.source} />
          {item.kind === 'thread' && item.category && <span className="row__cat">{item.category}</span>}
          {item.author && <span>by {item.author}</span>}
          {item.publishedAt && <span>{item.kind === 'post' ? 'posted' : 'started'} {formatDate(item.publishedAt)}</span>}
          <span>saved {formatDate(item.savedAt)}</span>
        </div>
        {item.excerpt && (
          <blockquote className="row__excerpt quote">
            <Highlight text={item.excerpt} query={query} />
          </blockquote>
        )}
        {item.notes && (
          <p className="notes">
            <Highlight text={item.notes} query={query} />
          </p>
        )}
        <div className="row__stats">
          {item.tags.map((t) => (
            <a key={t} className="tag tag--user" href={href(['library', item.kind === 'post' ? 'posts' : 'threads'], { tag: t })}>
              #{t}
            </a>
          ))}
          {cols.map((c) => (
            <span key={c} className="tag tag--col">
              {c}
            </span>
          ))}
          <a className="row__orig" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.kind === 'post' ? 'Exact post' : 'Original'} <IconExternal />
          </a>
        </div>
        <div className="row__actions">
          <button type="button" className="btn btn--small" onClick={() => setEditing(true)}>
            <IconEdit /> Tags, notes &amp; collections
          </button>
          <button type="button" className="btn btn--small" onClick={() => update((l) => updateItem(l, item.id, { read: !item.read }))}>
            <IconCheck /> Mark {item.read ? 'unread' : 'read'}
          </button>
          <button
            type="button"
            className="btn btn--small btn--danger"
            onClick={() => {
              if (confirm(`Remove “${item.title}” from your library? Notes and tags on it are deleted too.`)) update((l) => removeItem(l, item.id));
            }}
          >
            Remove
          </button>
        </div>
      </div>
      {editing && <SaveDialog item={item} onClose={() => setEditing(false)} />}
    </article>
  );
}
