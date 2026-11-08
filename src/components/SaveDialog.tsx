import { useEffect, useRef, useState } from 'react';
import { addCollection, normalizeTags, putItem, updateItem, type SavedItem } from '../lib/library';
import { useLibrary } from '../state/Library';
import { IconClose } from './Icons';

/** Edit (or create, when the item is not in the library yet) a saved item. */
export function SaveDialog({ item, onClose, title }: { item: SavedItem; onClose: () => void; title?: string }) {
  const { lib, update } = useLibrary();
  const existing = lib.items[item.id];
  const base = existing ?? item;
  const [tags, setTags] = useState(base.tags.join(', '));
  const [notes, setNotes] = useState(base.notes);
  const [cols, setCols] = useState<string[]>(base.collections);
  const [keepExcerpt, setKeepExcerpt] = useState(!!base.excerpt);
  const [newCol, setNewCol] = useState('');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);

  const save = () => {
    const patch = { tags: normalizeTags(tags.split(',')), notes, collections: cols, excerpt: keepExcerpt ? base.excerpt ?? item.excerpt : undefined };
    update((l) => (l.items[item.id] ? updateItem(l, item.id, patch) : putItem(l, { ...item, ...patch } as SavedItem)));
    onClose();
  };

  const createCollection = () => {
    if (!newCol.trim()) return;
    let created = '';
    update((l) => {
      const [next, c] = addCollection(l, newCol);
      created = c.id;
      return next;
    });
    if (created) setCols((c) => [...new Set([...c, created])]);
    setNewCol('');
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="save-title">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <header className="dialog__head">
          <h2 id="save-title">{title ?? (existing ? 'Edit saved item' : 'Save to library')}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <p className="dialog__subject">{item.title}</p>
        <label className="field">
          <span>Tags (comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Walls, duck canvas, 1950s" autoFocus />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="What makes this useful? Label details, dating clues…" />
        </label>
        <fieldset className="field">
          <legend>Collections</legend>
          <div className="checks">
            {Object.values(lib.collections)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <label key={c.id} className="toggle">
                  <input type="checkbox" checked={cols.includes(c.id)} onChange={(e) => setCols(e.target.checked ? [...cols, c.id] : cols.filter((x) => x !== c.id))} />
                  <span>{c.name}</span>
                </label>
              ))}
          </div>
          <div className="inline">
            <input value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="New collection" aria-label="New collection name"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCollection(); } }} />
            <button type="button" className="btn btn--small" onClick={createCollection}>
              Add
            </button>
          </div>
        </fieldset>
        {(base.excerpt || item.excerpt) && (
          <label className="toggle">
            <input type="checkbox" checked={keepExcerpt} onChange={(e) => setKeepExcerpt(e.target.checked)} />
            <span>Keep a short excerpt in my library (stored only in this browser)</span>
          </label>
        )}
        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </footer>
      </form>
    </dialog>
  );
}
