import { categoryKey } from '../lib/sort';
import type { SourceInfo } from '../lib/types';
import { Chip } from './Bits';

export function SourcePicker({ sources, selected, onChange }: { sources: SourceInfo[]; selected: string[]; onChange: (s: string[]) => void }) {
  const all = selected.length === 0;
  return (
    <div className="chips" role="group" aria-label="Forums">
      <Chip active={all} onClick={() => onChange([])}>
        All forums
      </Chip>
      {sources.map((s) => (
        <Chip
          key={s.id}
          active={selected.includes(s.id)}
          title={s.name}
          onClick={() => onChange(selected.includes(s.id) ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
        >
          <span className="swatch" style={{ background: s.color }} />
          {s.short}
        </Chip>
      ))}
    </div>
  );
}

/** Category select across the selected forums. Value is "<source>|<categoryId>" or "". */
export function CategorySelect({ sources, selectedSources, value, onChange, counts }: { sources: SourceInfo[]; selectedSources: string[]; value: string; onChange: (v: string) => void; counts?: Map<string, number> }) {
  const shown = sources.filter((s) => !selectedSources.length || selectedSources.includes(s.id));
  return (
    <label className="field field--inline">
      <span>Category</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All categories</option>
        {shown.map((s) => (
          <optgroup key={s.id} label={s.name}>
            {s.categories
              .filter((c) => !counts || (counts.get(categoryKey(s.id, c.id)) ?? 0) > 0)
              .map((c) => {
                const k = categoryKey(s.id, c.id);
                return (
                  <option key={k} value={k}>
                    {c.name}
                    {counts ? ` (${counts.get(k) ?? 0})` : ''}
                  </option>
                );
              })}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="field field--inline">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
