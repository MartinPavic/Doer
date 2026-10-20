import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  LogicalPosition,
  LogicalSize,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { useDueReminders, useTasks } from "@doer/core";
import { BellMark, Logo, QuickPanel, ReminderAlerts, useActiveProfile } from "@doer/ui";

const SIZE = 56;
const PANEL = { w: 360, h: 520 };
const ALERT_W = 340;
const FRESH_MS = 2 * 60_000; // only reminders this recent pop out on startup; older ones just keep the bubble pulsing
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

type Mode = "collapsed" | "alert" | "expanded";

export function Bubble() {
  const [mode, setModeState] = useState<Mode>("collapsed");
  const modeRef = useRef<Mode>("collapsed");
  const expandedAt = useRef(0);
  const anchor = useRef<Pt>({ x: 0, y: 0 }); // where the collapsed bubble rests
  const dragging = useRef(false);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const seen = useRef<Set<string> | null>(null); // reminders already popped out this session
  const { data: due = [], isSuccess } = useDueReminders();

  const setMode = (m: Mode) => {
    modeRef.current = m;
    setModeState(m);
  };

  /** Resize the window to w×h, growing from the bubble's corner nearest the screen centre so it stays on screen. */
  const place = useCallback(async (w: number, h: number) => {
    const area = await workArea();
    const a = anchor.current;
    const right = a.x + SIZE / 2 > area.x + area.w / 2;
    const bottom = a.y + SIZE / 2 > area.y + area.h / 2;
    const x = clamp(right ? a.x + SIZE - w : a.x, area.x, area.x + area.w - w);
    const y = clamp(bottom ? a.y + SIZE - h : a.y, area.y, area.y + area.h - h);
    await win.setSize(new LogicalSize(w, h));
    await moveTo({ x, y });
  }, []);

  const expand = useCallback(async () => {
    if (modeRef.current === "expanded") return;
    setMode("expanded");
    await place(PANEL.w, PANEL.h);
    expandedAt.current = Date.now();
    await win.setFocus();
  }, [place]);

  /** Reminder card next to the bubble. Doesn't take focus, so it never interrupts what you're typing elsewhere. */
  const popOut = useCallback(async () => {
    if (modeRef.current !== "collapsed") return; // panel already open: its alerts are shown there
    setMode("alert");
    await place(ALERT_W, 120); // AlertPopout then fits the height to its content
  }, [place]);

  const fitAlert = useCallback((h: number) => {
    if (modeRef.current === "alert") void place(ALERT_W, h);
  }, [place]);

  const collapse = useCallback(async () => {
    if (modeRef.current === "collapsed") return;
    setMode("collapsed");
    await win.setSize(new LogicalSize(SIZE, SIZE));
    await moveTo(anchor.current);
  }, []);

  // Pop out for each newly due reminder; leave the pop-out once everything is handled.
  useEffect(() => {
    if (!isSuccess) return;
    const key = (r: { id: string; fireAt: string }) => `${r.id}@${r.fireAt}`; // a snooze changes fireAt, so it pops again
    seen.current ??= new Set(due.filter((r) => Date.now() - new Date(r.fireAt).getTime() >= FRESH_MS).map(key));
    const fresh = due.filter((r) => !seen.current!.has(key(r)));
    fresh.forEach((r) => seen.current!.add(key(r)));
    if (fresh.length > 0) void popOut();
    else if (due.length === 0 && modeRef.current === "alert") void collapse();
  }, [due, isSuccess, popOut, collapse]);

  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout>;
    const cleanups: Array<Promise<() => void>> = [];

    // After a native drag ends (no more move events), snap to the nearest side edge and remember the spot.
    const settle = async () => {
      dragging.current = false;
      if (modeRef.current !== "collapsed") return;
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
        if (!focused && modeRef.current === "expanded" && Date.now() - expandedAt.current > 300) void collapse();
      }),
    );

    void queueShortcut(() =>
      register(SHORTCUT, (e) => {
        if (e.state !== "Pressed") return;
        // Collapsed or showing a reminder card: open the panel. Panel open: close it.
        void (modeRef.current === "expanded" ? collapse() : expand());
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

  if (mode === "expanded") {
    return (
      <div className="h-screen p-2">
        <QuickPanel onClose={() => void collapse()} />
      </div>
    );
  }

  if (mode === "alert") {
    return <AlertPopout onFit={fitAlert} onOpenPanel={() => void expand()} onClose={() => void collapse()} />;
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

function AlertPopout({ onFit, onOpenPanel, onClose }: { onFit(h: number): void; onOpenPanel(): void; onClose(): void }) {
  const card = useRef<HTMLDivElement>(null);
  // The window is sized to its content, so a second reminder arriving (or a card being handled) re-fits it.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onFit(Math.ceil(el.getBoundingClientRect().height) + 16));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onFit]);

  return (
    <div className="p-2">
      <div ref={card} className="space-y-2 rounded-3xl border border-line bg-surface p-3 shadow-2xl">
        <div className="flex items-center justify-between px-1">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"><BellMark size={20} shape="square" />Reminder</span>
          <div className="flex items-center gap-1">
            <button onClick={onOpenPanel} className="rounded-lg px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-fg">
              Open panel
            </button>
            <button onClick={onClose} aria-label="Hide" className="rounded-lg px-2 py-0.5 text-muted hover:bg-surface-2 hover:text-fg">
              ✕
            </button>
          </div>
        </div>
        <ReminderAlerts limit={3} onMore={onOpenPanel} />
      </div>
    </div>
  );
}

function BubbleFace() {
  const profile = useActiveProfile();
  const { data: tasks = [] } = useTasks(profile?.id ?? null, "today");
  const { data: due = [] } = useDueReminders();
  const alerting = due.length > 0;
  const count = alerting ? due.length : tasks.length;
  return (
    // The window is exactly 56px and clips anything outside it, so the 48px mark leaves a 4px margin
    // for its shadow, the profile dot and the badge.
    <span className={`relative size-12 rounded-full shadow-lg shadow-black/30 ${alerting ? "animate-pulse" : ""}`}>
      {alerting ? <BellMark size={48} shape="circle" /> : <Logo size={48} shape="circle" />}
      {/* Which profile new tasks go to: the app mark stays brand-coloured, the profile shows as a dot. */}
      {profile && (
        <span
          title={profile.name}
          className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-white"
          style={{ background: profile.color }}
        />
      )}
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </span>
  );
}
