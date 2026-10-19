import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { makeDedupe, toastKey } from '../lib.js';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function Toasts({ children }) {
  const [items, setItems] = useState([]);
  const fresh = useRef(makeDedupe(2000)); // identical toast within 2s (e.g. a re-delivered event) shows once
  const push = useCallback((msg, kind = 'info', key) => {
    if (!fresh.current(toastKey(kind, msg, key))) return;
    const id = Math.random();
    setItems(i => [...i, { id, msg, kind }]);
    setTimeout(() => setItems(i => i.filter(t => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return <ToastCtx.Provider value={push}>{children}
    <div className="toasts">{items.map(t => <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems(i => i.filter(x => x.id !== t.id))}>{t.msg}</div>)}</div>
  </ToastCtx.Provider>;
}

