import { Icon } from './Icon.jsx';
import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';

export function Dialog({ title, children, footer, onClose, wide }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return <div className="modal" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={'card' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
      <div className="card-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      <div className="card-body">{children}</div>
      <div className="card-foot">{footer}</div>
    </div></div>;
}
export function Confirm({ title, message, danger, confirmLabel = 'Confirm', onConfirm, onClose }) {
  return <Dialog title={title} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className={danger ? 'btn-danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></>}>
    <p>{message}</p></Dialog>;
}

