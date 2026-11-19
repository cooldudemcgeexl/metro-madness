import { useMemo } from "react";
import { isOk, type OkPlan } from "../lib/plan.ts";
import { useAppStore } from "../store/useAppStore.ts";

/** Plans drawn on the map and timeline: the compared ones, plus the focused one if it isn't compared. */
export function useShownPlans(): OkPlan[] {
  const plans = useAppStore((s) => s.plans);
  const compare = useAppStore((s) => s.compare);
  const focus = useAppStore((s) => s.focus);
  return useMemo(() => {
    const ids = [...compare];
    if (focus != null && !ids.includes(focus)) ids.push(focus);
    return ids.map((id) => plans[id]).filter(isOk);
  }, [plans, compare, focus]);
}

/** The focused plan, if any. */
export function useFocusPlan() {
  return useAppStore((s) => (s.focus != null ? s.plans[s.focus] : undefined));
}
