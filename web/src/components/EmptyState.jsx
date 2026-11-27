import React from 'react';
import '../get-started.css';

// Body of an empty table cell: what this page is for and the first useful actions.
export function EmptyState({ title, text, actions = [], onAction }) {
  return <div className="empty-state">
    <strong>{title}</strong>
    {text && <p className="muted small">{text}</p>}
    {actions.length > 0 && <div className="empty-actions">
      {actions.map(a => <button type="button" key={a.id} className={a.primary ? 'primary' : ''} onClick={() => onAction(a.id)}>{a.label}</button>)}
    </div>}
  </div>;
}
