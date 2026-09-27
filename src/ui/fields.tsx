import { useEffect, useState, type ReactNode } from 'react';
import { formatFtIn, parseLength } from '../model/units';

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-input">{children}</span>
    </label>
  );
}

/** Text input that commits on Enter or blur and reverts on Escape. */
function useCommitInput(display: string, commit: (s: string) => boolean) {
  const [text, setText] = useState(display);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(display);
    setBad(false);
  }, [display]);
  return {
    value: text,
    'aria-invalid': bad || undefined,
    className: bad ? 'bad' : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    onBlur: () => {
      if (text === display) return;
      const ok = commit(text);
      setBad(!ok);
      if (!ok) setText(display);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      if (e.key === 'Escape') {
        setText(display);
        (e.target as HTMLInputElement).blur();
      }
    },
  };
}

/** Length in inches, shown and typed as feet-inches (12'-6", 150, 12.5'). */
export function LengthField(props: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; optional?: boolean; placeholder?: string; hint?: string }) {
  const input = useCommitInput(props.value === undefined ? '' : formatFtIn(props.value, 0.125), (s) => {
    if (s.trim() === '' && props.optional) {
      props.onChange(undefined);
      return true;
    }
    const v = parseLength(s);
    if (v === null || (props.min !== undefined && v < props.min)) return false;
    props.onChange(Math.round(v * 1000) / 1000);
    return true;
  });
  return (
    <Row label={props.label} hint={props.hint}>
      <input type="text" {...input} placeholder={props.placeholder} spellCheck={false} />
    </Row>
  );
}

export function NumberField(props: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; hint?: string }) {
  const input = useCommitInput(String(props.value), (s) => {
    const v = Number(s);
    if (!Number.isFinite(v)) return false;
    if (props.min !== undefined && v < props.min) return false;
    if (props.max !== undefined && v > props.max) return false;
    props.onChange(v);
    return true;
  });
  return (
    <Row label={props.label} hint={props.hint}>
      <input type="text" inputMode="decimal" {...input} />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </Row>
  );
}

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const input = useCommitInput(props.value, (s) => {
    props.onChange(s);
    return true;
  });
  return (
    <Row label={props.label}>
      <input type="text" {...input} placeholder={props.placeholder} />
    </Row>
  );
}

export function SelectField<T extends string>(props: { label: string; value: T; options: readonly T[] | { value: T; label: string }[]; onChange: (v: T) => void }) {
  const opts = (props.options as (T | { value: T; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <Row label={props.label}>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function CheckField(props: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Row label={props.label} hint={props.hint}>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
    </Row>
  );
}

export function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <Row label={props.label}>
      <input type="color" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== props.value && props.onChange(v)} />
      <code className="suffix">{v}</code>
    </Row>
  );
}

export function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row readout">
      <span className="row-label">{label}</span>
      <span className="row-input">{children}</span>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
