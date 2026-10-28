import React from 'react';
// Minimal inline SVG icon set (stroke icons, 24px grid). No external deps.
const P = {
  dashboard: 'M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3',
  profiles: 'M4 5h16v14H4zM4 9h16M8 13h5M8 16h3',
  storage: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  proxies: 'M5 12h14M15 6l6 6-6 6M9 6L3 12l6 6',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  diagnostics: 'M3 12h4l3-8 4 16 3-8h4',
  play: 'M7 4l13 8-13 8z', stop: 'M6 6h12v12H6z', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3',
  folder: 'M3 6h6l2 2h10v11H3z', tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  extensions: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5L20 7',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', upload: 'M12 16V4M6 10l6-6 6 6M4 20h16', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
};
export function Icon({ name, size = 16, className = '' }) {
  return <svg className={'i ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name]} /></svg>;
}
