import React, { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

// Three-dot menu rendered in a fixed-position portal so the scrolling table cannot clip it.
// items: [{ key, label, ariaLabel, icon, onSelect, disabled, danger, separatorBefore, title }]
export function RowActionsMenu({ label, items, buttonClassName = 'icon-btn row-more', icon = 'more' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null), menu = useRef(null);
  const id = useId();
  const enabled = items.filter(item => !item.hidden);

  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect(), m = menu.current.getBoundingClientRect();
    const below = innerHeight - r.bottom, top = below < m.height + 8 && r.top > m.height + 8 ? r.top - m.height - 4 : r.bottom + 4;
    const left = Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8));
    setPos({ top: Math.max(8, top), left });
    menu.current.querySelector('[role=menuitem]:not([disabled])')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false); };
    const dismiss = e => { if (!menu.current?.contains(e.target)) close(false); };
    document.addEventListener('mousedown', outside);
    addEventListener('resize', dismiss); addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('mousedown', outside); removeEventListener('resize', dismiss); removeEventListener('scroll', dismiss, true); };
  }, [open]);

  const onKeyDown = e => {
    const nodes = [...menu.current.querySelectorAll('[role=menuitem]:not([disabled])')];
    const at = nodes.indexOf(document.activeElement);
    const go = i => { e.preventDefault(); nodes[(i + nodes.length) % nodes.length]?.focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(nodes.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  return <>
    <button ref={btn} type="button" className={buttonClassName} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(v => !v)}><Icon name={icon} size={16} /></button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="row-menu" onKeyDown={onKeyDown}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
      {enabled.map(item => <React.Fragment key={item.key}>
        {item.separatorBefore && <div className="row-menu-sep" role="separator" />}
        <button type="button" role="menuitem" className={item.danger ? 'danger' : ''} aria-label={item.ariaLabel || item.label} title={item.title}
          disabled={item.disabled} onClick={() => { close(); item.onSelect(); }}>
          {item.icon ? <Icon name={item.icon} size={15} /> : <span className="row-menu-gap" />}<span>{item.label}</span>
        </button>
      </React.Fragment>)}
    </div>, document.body)}
  </>;
}
