import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
// Loads the reusable proxy library (docs/proxy-api.md). `available` is false when the
// server doesn't implement /api/proxies yet (404), so screens can fall back honestly.
export function useProxyLibrary(params = {}) {
  const [state, setState] = useState({ list: [], available: null, error: null, loading: true });
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try { setState({ list: await api('/api/proxies' + (qs ? '?' + qs : '')), available: true, error: null, loading: false }); }
    catch (e) { setState(s => ({ ...s, available: /not found|404/i.test(e.message) ? false : s.available ?? true, error: e.message, loading: false })); }
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
