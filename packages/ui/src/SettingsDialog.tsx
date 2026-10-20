import { useEffect, useState } from "react";
import {
  useCalendarAccountActions, useCalendarAccounts, useConnectGoogle, useDoer, useExportData, useSetNotifyHere, useThisDevice, useUpdateProfile,
  type Profile, type QuietHours,
} from "@doer/core";
import { REMINDER_OFFSETS } from "./reminder-options";

const field = "rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent";

/** Connected calendars of one profile: link Google, choose which calendars to show, sync, disconnect. */
function CalendarsSection({ profile }: { profile: Profile }) {
  // After "Connect" the user finishes in their browser: poll until a new account appears (or give up after 3 min).
  const [waiting, setWaiting] = useState<{ since: number; baseCount: number } | null>(null);
  const { data: accounts = [] } = useCalendarAccounts(profile.id, waiting ? 3000 : false);
  const connect = useConnectGoogle(profile.id);
  const { toggleCalendar, setWriteTarget, disconnect, syncNow } = useCalendarAccountActions(profile.id);
  const updateProfile = useUpdateProfile();
  const writable = accounts.flatMap((a) => a.calendars.filter((c) => c.writable).map((c) => ({ ...c, email: a.email })));
  const mirrorTarget = profile.mirrorTasks ? writable.find((c) => c.isWriteTarget)?.id ?? "" : "";
  const startConnect = () => {
    connect.mutate();
    setWaiting({ since: Date.now(), baseCount: accounts.length });
  };

  useEffect(() => {
    if (!waiting) return;
    if (accounts.length > waiting.baseCount) setWaiting(null);
    const timeout = setTimeout(() => setWaiting(null), Math.max(0, waiting.since + 180_000 - Date.now()));
    return () => clearTimeout(timeout);
  }, [accounts.length, waiting]);

  const btn = "rounded-lg px-2.5 py-1 text-xs font-medium transition";
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Calendars</h3>
      {accounts.map((a) => (
        <div key={a.id} className="space-y-1.5 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm">📅 {a.email}</span>
            <div className="flex shrink-0 gap-1">
              {a.status === "reconnect" && (
                <button onClick={startConnect} className={`${btn} bg-danger/10 text-danger`}>Reconnect</button>
              )}
              <button onClick={() => syncNow.mutate()} disabled={syncNow.isPending} className={`${btn} text-muted hover:bg-surface-2`}>
                {syncNow.isPending ? "Syncing…" : "Sync now"}
              </button>
              <button onClick={() => disconnect.mutate(a.id)} className={`${btn} text-muted hover:bg-danger/10 hover:text-danger`}>Disconnect</button>
            </div>
          </div>
          {a.status === "reconnect" && <p className="text-xs text-danger">Google access expired or was revoked. Reconnect to resume syncing.</p>}
          <ul className="space-y-1">
            {a.calendars.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={c.selected} onChange={(e) => toggleCalendar.mutate({ id: c.id, selected: e.target.checked })} />
                  <span className="size-2.5 rounded-full" style={{ background: c.color ?? "#64748b" }} />
                  <span className="truncate">{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          onClick={startConnect}
          disabled={connect.isPending}
          className="rounded-xl border border-line px-3 py-2 text-sm hover:border-accent"
        >
          + Connect Google Calendar
        </button>
        {waiting && <span className="text-xs text-muted">Finish in your browser… this updates automatically.</span>}
      </div>
      {connect.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{connect.error.message}</p>}
      {writable.length > 0 && (
        <label className="flex items-center justify-between gap-3 pt-1 text-sm text-muted">
          Add my timed tasks to
          <select
            value={mirrorTarget}
            onChange={(e) => {
              const id = e.target.value;
              if (id) setWriteTarget.mutate(id);
              updateProfile.mutate({ id: profile.id, mirrorTasks: !!id });
            }}
            className="max-w-[55%] rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          >
            <option value="">Nowhere (off)</option>
            {writable.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
          </select>
        </label>
      )}
      <p className="text-xs text-muted">
        Events from the selected calendars appear on {profile.name}'s calendar only.
        {writable.length > 0 && " Mirrored tasks show a ✓ in the event title once completed."}
      </p>
    </section>
  );
}

function DataSection() {
  const exportData = useExportData();
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium">Your data</h3>
      <button
        onClick={() => exportData.mutate()}
        disabled={exportData.isPending}
        className="rounded-xl border border-line px-3 py-2 text-sm hover:border-accent disabled:opacity-60"
      >
        {exportData.isPending ? "Exporting…" : "Export everything (JSON)"}
      </button>
      {exportData.isSuccess && <p className="text-xs text-muted">Saved to {exportData.data}.</p>}
      {exportData.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{exportData.error.message}</p>}
      <p className="text-xs text-muted">All profiles and tasks across Work and Private. Sign-in and calendar tokens are never included.</p>
    </section>
  );
}

export function SettingsDialog({ profile, onClose }: { profile: Profile; onClose(): void }) {
  const { platform } = useDoer();
  const update = useUpdateProfile();
  const device = useThisDevice();
  const setNotifyHere = useSetNotifyHere();

  const [offset, setOffset] = useState(profile.defaultReminderOffset);
  const [allDayTime, setAllDayTime] = useState(profile.allDayReminderTime);
  const [quiet, setQuiet] = useState<QuietHours | null>(profile.quietHours);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function save() {
    update.mutate(
      { id: profile.id, defaultReminderOffset: offset, allDayReminderTime: allDayTime, quietHours: quiet },
      { onSuccess: onClose },
    );
  }

  const canAlert = platform.isDesktop || !!platform.enablePush;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Settings"
        className="max-h-[90vh] w-full max-w-md space-y-5 overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="size-2.5 rounded-full" style={{ background: profile.color }} />
            {profile.name} settings
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-muted hover:bg-surface-2">✕</button>
        </header>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Reminders</h3>
          <label className="flex items-center justify-between gap-3 text-sm text-muted">
            Default reminder for timed tasks
            <select value={offset} onChange={(e) => setOffset(Number(e.target.value))} className={field}>
              {REMINDER_OFFSETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm text-muted">
            All-day tasks remind at
            <input type="time" value={allDayTime} onChange={(e) => setAllDayTime(e.target.value)} className={field} />
          </label>
        </section>

        <section className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={!!quiet}
              onChange={(e) => setQuiet(e.target.checked ? { tz, start: "18:00", end: "09:00", weekends: true } : null)}
            />
            Quiet hours
          </label>
          {quiet ? (
            <div className="space-y-2 text-sm text-muted">
              <div className="flex items-center gap-2">
                No alerts from
                <input type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} className={field} />
                until
                <input type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} className={field} />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={quiet.weekends} onChange={(e) => setQuiet({ ...quiet, weekends: e.target.checked })} />
                Also all day on weekends
              </label>
              <p className="text-xs">Reminders in this window are delayed until it ends, never dropped. Times are in {quiet.tz}.</p>
            </div>
          ) : (
            <p className="text-xs text-muted">Off: reminders fire exactly on time.</p>
          )}
        </section>

        <CalendarsSection profile={profile} />

        <DataSection />

        {canAlert && (
          <section className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                disabled={!device.data || setNotifyHere.isPending}
                checked={!!device.data?.notifyHere}
                onChange={(e) => setNotifyHere.mutate(e.target.checked)}
              />
              Alert me on this device{device.data ? ` (${device.data.label})` : ""}
            </label>
            <p className="text-xs text-muted">
              Reminders only notify devices with this on, so you aren't alerted twice.
            </p>
          </section>
        )}

        {update.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{update.error.message}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-surface-2">Cancel</button>
          <button
            onClick={save}
            disabled={update.isPending}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
