import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function Toasts({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'info') => {
    const id = Math.random();
    setItems(i => [...i, { id, msg, kind }]);
    setTimeout(() => setItems(i => i.filter(t => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return <ToastCtx.Provider value={push}>{children}
    <div className="toasts">{items.map(t => <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems(i => i.filter(x => x.id !== t.id))}>{t.msg}</div>)}</div>
  </ToastCtx.Provider>;
}

