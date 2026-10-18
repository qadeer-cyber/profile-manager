import React, { useEffect } from 'react';
import { Icon } from './Icon.jsx';
// Right-side slide-over panel used for editors.
export function Drawer({ title, subtitle, children, footer, onClose }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return <div className="drawer-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <aside className="drawer" role="dialog" aria-label={title}>
      <header className="drawer-head"><div><h3>{title}</h3>{subtitle && <div className="muted">{subtitle}</div>}</div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
      <div className="drawer-body">{children}</div>
      <footer className="drawer-foot">{footer}</footer>
    </aside></div>;
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={'tab' + (value === k ? ' sel' : '')} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
