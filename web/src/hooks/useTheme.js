import { useEffect, useState } from 'react';
// Theme preference persisted locally; 'system' follows the OS setting.
export function useTheme() {
  const [pref, setPref] = useState(() => localStorage.getItem('pm.theme') || 'system');
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.dataset.theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
    apply(); localStorage.setItem('pm.theme', pref);
    mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [pref]);
  return [pref, setPref];
}
