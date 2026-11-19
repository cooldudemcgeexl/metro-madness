import { useLayoutEffect, useState, type RefObject } from "react";

/** Content-box size of an element, kept current with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number, height: number) =>
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    const r = el.getBoundingClientRect();
    update(r.width, r.height);
    const ro = new ResizeObserver(([entry]) =>
      update(entry.contentRect.width, entry.contentRect.height),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
