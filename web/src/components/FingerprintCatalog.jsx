import React from 'react';
import { categoryById } from '../../../server/fingerprint-catalog.js';

// Disabled <option>s for the modes a category cannot offer. They stay visible in the select so
// the gap is explicit, but they can never be chosen (and the server rejects them anyway).
export function UnavailableOptions({ category }) {
  const modes = categoryById(category)?.modes.filter(mode => mode.state === 'unsupported') || [];
  if (!modes.length) return null;
  return <optgroup label="Not available on stock Chromium">
    {modes.map(mode => <option key={mode.id} value={`unavailable:${mode.id}`} disabled title={mode.reason}>{mode.label} — unavailable</option>)}
  </optgroup>;
}

// Explains every unavailable or conditional mode for a category in the existing hint style.
export function CategoryNotes({ category }) {
  const cat = categoryById(category);
  const unsupported = cat?.modes.filter(mode => mode.state === 'unsupported') || [];
  const conditional = cat?.modes.filter(mode => mode.state === 'conditional') || [];
  if (!unsupported.length && !conditional.length) return null;
  return <details className="proxy-rules fp-notes" data-category={category}>
    <summary>{cat.label}: {unsupported.length ? `${unsupported.length} unavailable mode${unsupported.length === 1 ? '' : 's'}` : ''}{unsupported.length && conditional.length ? ', ' : ''}{conditional.length ? `${conditional.length} conditional` : ''}</summary>
    <ul className="muted small">
      {conditional.map(mode => <li key={mode.id}><strong>{mode.label}</strong> (conditional): {mode.requires}</li>)}
      {unsupported.map(mode => <li key={mode.id}><strong>{mode.label}</strong>: {mode.reason}</li>)}
    </ul>
  </details>;
}

// A category whose value is always the browser's own: one fixed pill plus the visible, disabled
// alternatives.
export function FixedCategory({ category, note }) {
  const cat = categoryById(category);
  const real = cat.modes.find(mode => mode.state === 'supported');
  return <ModeSegment category={category} label={cat.label} value={real.id} options={[{ id: real.id, label: real.label }]} note={note} />;
}

// Multilogin-style segmented choice for one fingerprint category, built on the existing `.seg` pills.
// Modes this engine can apply are selectable; modes stock Chrome cannot apply (catalog state
// "unsupported", e.g. Masked or Noise) stay visible as disabled pills with the reason as a tooltip.
// They can never be chosen, and the server rejects them anyway.
export function ModeSegment({ category, label, value, options, onChange, note }) {
  const unavailable = categoryById(category)?.modes.filter(mode => mode.state === 'unsupported') || [];
  const pick = (event, id) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChange?.(id); } };
  return <div className="fp-field" data-category={category}>
    <span className="fp-label">{label}</span>
    <div className="seg fp-seg" role="radiogroup" aria-label={label}>
      {options.map(o => <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'sel' : ''}
        disabled={!onChange && value !== o.id} title={o.title} onClick={() => onChange?.(o.id)} onKeyDown={e => pick(e, o.id)}>{o.label}</button>)}
      {unavailable.map(mode => <button key={'u-' + mode.id} type="button" role="radio" aria-checked={false} disabled data-unavailable={mode.id}
        title={`Not available on stock Chrome: ${mode.reason}`} aria-label={`${mode.label}, unavailable`}>{mode.label}</button>)}
    </div>
    {note && <span className="muted hint">{note}</span>}
    <CategoryNotes category={category} />
  </div>;
}
