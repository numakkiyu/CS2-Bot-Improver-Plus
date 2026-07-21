import { useEffect, useRef } from "react";

export function useSelectedPickerScroll(open: boolean, selection: string | number) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current;
      const selected = list?.querySelector<HTMLElement>(".is-selected");
      if (!list || !selected) return;

      const centeredTop = selected.offsetTop
        - list.offsetTop
        - (list.clientHeight - selected.clientHeight) / 2;
      list.scrollTop = Math.max(0, centeredTop);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, selection]);

  return listRef;
}
