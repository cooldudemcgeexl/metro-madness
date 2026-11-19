import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTooltip } from "../store/useTooltip.ts";

export function Tooltip() {
  const { content, visible, x, y, move } = useTooltip();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!visible) return;
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, [visible, move]);

  // Keep the tip on screen: flip to the other side of the pointer near the edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x + 14;
    let top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
    // `content` is listed on purpose: new content changes the tip's size, so re-measure.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [x, y, content]);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-[300px] rounded-md bg-ink px-[9px] pt-1.5 pb-1 text-xs leading-[1.4] text-surface transition-opacity duration-75 [&_b]:font-bold"
      style={{ ...pos, opacity: visible ? 1 : 0 }}
    >
      {content}
    </div>
  );
}
