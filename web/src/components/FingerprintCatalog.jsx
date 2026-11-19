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

// A category whose value is always the browser's own: one selectable mode plus the visible,
// disabled alternatives.
export function FixedCategory({ category, note }) {
  const cat = categoryById(category);
  const real = cat.modes.find(mode => mode.state === 'supported');
  return <>
    <label>{cat.label}<select aria-label={cat.label} value={real.id} onChange={() => {}} data-category={category}>
      <option value={real.id}>{real.label}</option>
      <UnavailableOptions category={category} />
    </select>{note && <span className="muted hint">{note}</span>}</label>
    <CategoryNotes category={category} />
  </>;
}
