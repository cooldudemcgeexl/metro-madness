import type { ReactNode } from 'react';
import { create } from 'zustand';

interface Point {
  clientX: number;
  clientY: number;
}

interface TooltipState {
  content: ReactNode;
  visible: boolean;
  x: number;
  y: number;
  show: (content: ReactNode, at: Point) => void;
  move: (at: Point) => void;
  hide: () => void;
}

/** One floating tooltip shared by the map and the timeline; follows the pointer while visible. */
export const useTooltip = create<TooltipState>()((set) => ({
  content: null,
  visible: false,
  x: 0,
  y: 0,
  show: (content, at) => set({ content, visible: true, x: at.clientX, y: at.clientY }),
  move: (at) => set({ x: at.clientX, y: at.clientY }),
  hide: () => set({ visible: false }),
}));
