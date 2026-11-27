import React, { useState } from 'react';
import { attentionItems, attentionSignature, bannerVisible } from '../lib/attention.js';
import '../get-started.css';

// Profiles-page banner for things that need a decision: interrupted data operations and profiles that stopped with an
// error. Dismissing hides it until the counts change.
export function AttentionBanner({ meta, onAction }) {
  const items = attentionItems({ errorCount: meta.errorCount ?? 0, recoveryPendingCount: meta.recoveryPendingCount ?? 0 });
  const [dismissed, setDismissed] = useState('');
  if (!bannerVisible(items, dismissed)) return null;
  return <section className="notice warn attention-banner" role="alert" aria-label="Needs attention">
    <ul>{items.map(item => <li key={item.id}>
      <span><strong>{item.text}</strong> <span className="muted small">{item.detail}</span></span>
      <button type="button" onClick={() => onAction(item.action)}>{item.actionLabel}</button>
    </li>)}</ul>
    <button type="button" className="ghost" onClick={() => setDismissed(attentionSignature(items))}>Dismiss</button>
  </section>;
}
