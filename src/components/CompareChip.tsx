import type { CSSProperties, MouseEvent } from "react";
import { slotColor, useAppStore } from "../store/useAppStore.ts";
import { cx, focusRing } from "./ui.tsx";

/** Toggle button that adds a plan to (or removes it from) the comparison. */
export function CompareChip({ id }: { id: number }) {
  const comparing = useAppStore((s) => s.compare.includes(id));
  const slot = useAppStore((s) => s.slots[id]);
  const toggleCompare = useAppStore((s) => s.toggleCompare);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    toggleCompare(id);
  };
  return (
    <button
      type="button"
      aria-pressed={comparing}
      className={cx(
        "inline-flex items-center gap-[5px] rounded-full border border-line bg-surface px-2 pt-[3px] pb-px text-[11px] font-bold tracking-[.04em] text-ink-2 uppercase aria-pressed:border-(color:--c) aria-pressed:text-ink",
        focusRing,
      )}
      style={{ "--c": comparing ? slotColor(slot) : "transparent" } as CSSProperties}
      onClick={onClick}
    >
      <span className="size-[9px] rounded-full border-[1.5px] border-[color:var(--c,var(--muted))] bg-[color:var(--c,transparent)]" />
      {comparing ? "Comparing" : "Compare"}
    </button>
  );
}
