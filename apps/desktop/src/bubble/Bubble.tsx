import { useCallback, useEffect, useRef, useState } from "react";
import {
  LogicalPosition,
  LogicalSize,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { useDueReminders, useTasks } from "@doer/core";
import { QuickPanel, useActiveProfile } from "@doer/ui";

const SIZE = 56;
const PANEL = { w: 360, h: 520 };
const MARGIN = 8;
const POS_KEY = "doer-bubble-pos";
const SHORTCUT = "Alt+Space";

type Pt = { x: number; y: number };
type Rect = Pt & { w: number; h: number };

const win = getCurrentWindow();

// Shortcut (un)registration is async and order-sensitive (StrictMode mounts effects twice in dev),
// so run every call through one queue.
let shortcutQueue: Promise<unknown> = Promise.resolve();
const queueShortcut = (fn: () => Promise<unknown>) =>
  (shortcutQueue = shortcutQueue.then(fn).catch((err) => console.warn(`${SHORTCUT} shortcut`, err)));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// All geometry below is in logical (point) units, in the macOS global coordinate space.
const toRect = (m: Awaited<ReturnType<typeof currentMonitor>>): Rect => {
  if (!m) return { x: 0, y: 0, w: 1440, h: 900 };
  const sf = m.scaleFactor;
  const wa = m.workArea;
  return { x: wa.position.x / sf, y: wa.position.y / sf, w: wa.size.width / sf, h: wa.size.height / sf };
};
const workArea = async () => toRect(await currentMonitor());

async function position(): Promise<Pt> {
  const [p, sf] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
  return { x: p.x / sf, y: p.y / sf };
}
const moveTo = (p: Pt) => win.setPosition(new LogicalPosition(p.x, p.y));

async function initialAnchor(): Promise<Pt> {
  const areas = (await availableMonitors()).map(toRect);
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as Pt | null;
    // Ignore a saved spot if its display was unplugged.
    if (saved && areas.some((a) => saved.x >= a.x && saved.x <= a.x + a.w - SIZE && saved.y >= a.y && saved.y <= a.y + a.h - SIZE)) {
      return saved;
    }
  } catch {
    /* fall through to default */
  }
  const a = await workArea();
  return { x: a.x + a.w - SIZE - MARGIN, y: a.y + a.h * 0.4 };
}

async function tween(from: Pt, to: Pt) {
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = 1 - (1 - i / steps) ** 3; // ease-out
    await moveTo({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await new Promise((r) => setTimeout(r, 14));
  }
}

export function Bubble() {
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const expandedAt = useRef(0);
  const anchor = useRef<Pt>({ x: 0, y: 0 }); // where the collapsed bubble rests
  const dragging = useRef(false);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const expand = useCallback(async () => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    // Grow from the bubble's corner nearest the screen centre so the panel stays on screen.
    const area = await workArea();
    const a = anchor.current;
    const right = a.x + SIZE / 2 > area.x + area.w / 2;
    const bottom = a.y + SIZE / 2 > area.y + area.h / 2;
    const x = clamp(right ? a.x + SIZE - PANEL.w : a.x, area.x, area.x + area.w - PANEL.w);
    const y = clamp(bottom ? a.y + SIZE - PANEL.h : a.y, area.y, area.y + area.h - PANEL.h);
    await win.setSize(new LogicalSize(PANEL.w, PANEL.h));
    await moveTo({ x, y });
    expandedAt.current = Date.now();
    setExpanded(true);
    await win.setFocus();
  }, []);

  const collapse = useCallback(async () => {
    if (!expandedRef.current) return;
    expandedRef.current = false;
    setExpanded(false);
    await win.setSize(new LogicalSize(SIZE, SIZE));
    await moveTo(anchor.current);
  }, []);

  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout>;
    const cleanups: Array<Promise<() => void>> = [];

    // After a native drag ends (no more move events), snap to the nearest side edge and remember the spot.
    const settle = async () => {
      dragging.current = false;
      if (expandedRef.current) return;
      const [area, p] = await Promise.all([workArea(), position()]);
      const toRight = p.x + SIZE / 2 > area.x + area.w / 2;
      const target = {
        x: toRight ? area.x + area.w - SIZE - MARGIN : area.x + MARGIN,
        y: clamp(p.y, area.y + MARGIN, area.y + area.h - SIZE - MARGIN),
      };
      await tween(p, target);
      anchor.current = target;
      localStorage.setItem(POS_KEY, JSON.stringify(target));
    };

    void (async () => {
      anchor.current = await initialAnchor();
      await moveTo(anchor.current);
      await win.show(); // window starts hidden so it never flashes at the wrong spot
    })();

    cleanups.push(
      win.onMoved(() => {
        if (!dragging.current) return;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => void settle(), 180);
      }),
      // Click outside (focus lost) collapses; ignore the blur that can accompany the expand itself.
      win.onFocusChanged(({ payload: focused }) => {
        if (!focused && expandedRef.current && Date.now() - expandedAt.current > 300) void collapse();
      }),
    );

    void queueShortcut(() =>
      register(SHORTCUT, (e) => {
        if (e.state !== "Pressed") return;
        void (expandedRef.current ? collapse() : expand());
      }),
    );

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void collapse();
    window.addEventListener("keydown", onKey);

    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener("keydown", onKey);
      void queueShortcut(() => unregister(SHORTCUT));
      cleanups.forEach((p) => void p.then((off) => off()));
    };
  }, [expand, collapse]);

  if (expanded) {
    return (
      <div className="h-screen p-2">
        <QuickPanel onClose={() => void collapse()} />
      </div>
    );
  }

  return (
    <button
      aria-label="Open Doer quick panel"
      className="flex size-14 cursor-grab items-center justify-center bg-transparent p-0 active:cursor-grabbing"
      onPointerDown={(e) => {
        press.current = { x: e.screenX, y: e.screenY, moved: false };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.moved || Math.hypot(e.screenX - p.x, e.screenY - p.y) < 4) return;
        // Past the click threshold: hand over to the OS for a smooth native drag.
        p.moved = true;
        dragging.current = true;
        void win.startDragging();
      }}
      onPointerUp={() => {
        const p = press.current;
        press.current = null;
        if (p && !p.moved) void expand();
      }}
    >
      <BubbleFace />
    </button>
  );
}

function BubbleFace() {
  const profile = useActiveProfile();
  const { data: tasks = [] } = useTasks(profile?.id ?? null, "today");
  const { data: due = [] } = useDueReminders();
  const alerting = due.length > 0;
  const count = alerting ? due.length : tasks.length;
  return (
    // The window is exactly 56px and clips anything outside it, so the 48px circle leaves a 4px
    // margin for its ring, shadow and badge.
    <span className="relative size-12">
      <span
        className={`flex size-full items-center justify-center rounded-full text-xl font-bold text-white shadow-md ring-2 ring-white/80 ${alerting ? "animate-pulse" : ""}`}
        style={{ background: profile?.color ?? "var(--accent)" }}
      >
        {alerting ? "🔔" : "✓"}
      </span>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </span>
  );
}
