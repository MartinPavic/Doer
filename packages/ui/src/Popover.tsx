import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 8;

/**
 * Dropdown anchored to an element. Rendered in a portal with fixed positioning so it never changes
 * its parent's layout and isn't clipped by `overflow-hidden` ancestors. Opens below the anchor,
 * flips above when there's no room, and stays inside the window horizontally.
 */
export function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current?.getBoundingClientRect();
    if (!a || !p) return;
    const below = a.bottom + GAP;
    const fitsBelow = below + p.height <= window.innerHeight - EDGE;
    const top = fitsBelow ? below : Math.max(EDGE, a.top - GAP - p.height);
    const left = Math.min(Math.max(EDGE, a.left), Math.max(EDGE, window.innerWidth - p.width - EDGE));
    setPos({ top, left });
  };

  // Measure after the first paint of the (hidden) panel, then show it in place.
  useLayoutEffect(place, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // don't also collapse the bubble panel
      onClose();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }); // re-bind each render so onClose is never stale

  return createPortal(
    <div
      ref={panel}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      className="fixed z-50 w-max rounded-2xl border border-line bg-surface p-2.5 shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}
