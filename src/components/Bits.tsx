import type { ReactNode } from 'react';
import { highlight, type ParsedQuery } from '../lib/search';
import type { SourceInfo } from '../lib/types';
import { useAppData } from '../state/AppData';

export function Highlight({ text, query }: { text: string; query?: ParsedQuery | null }) {
  if (!query) return <>{text}</>;
  return (
    <>
      {highlight(text, query).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}

export function SourceBadge({ id, source }: { id?: string; source?: SourceInfo }) {
  const { source: lookup } = useAppData();
  const s = source ?? lookup(id);
  const label = s?.short ?? (id === 'other' ? 'Other' : id ?? '?');
  return (
    <span className="badge" style={{ ['--badge' as string]: s?.color ?? '#777' }} title={s?.name}>
      {label}
    </span>
  );
}

export function Chip({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className={`chip${active ? ' chip--on' : ''}`} aria-pressed={!!active} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'note'}>{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
