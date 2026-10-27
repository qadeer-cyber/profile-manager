import { useCallback, useEffect, useState } from 'react';
// Multi-select over a list of ids; prunes ids that disappear from the list.
export function useSelection(ids) {
  const [sel, setSel] = useState(() => new Set());
  const key = ids.join(',');
  useEffect(() => { setSel(s => { const n = new Set([...s].filter(id => ids.includes(id))); return n.size === s.size ? s : n; }); }, [key]);
  const toggle = useCallback(id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const all = ids.length > 0 && ids.every(id => sel.has(id));
  const toggleAll = () => setSel(all ? new Set() : new Set(ids));
  return { sel, toggle, toggleAll, all, some: sel.size > 0 && !all, clear: () => setSel(new Set()) };
}
