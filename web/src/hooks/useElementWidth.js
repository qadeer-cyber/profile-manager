import { useEffect, useRef, useState } from 'react';

// Tracks an element's content width with ResizeObserver so components can move lower-priority
// controls into overflow menus instead of clipping them. Returns [ref, width].
export function useElementWidth(initial = Infinity) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
