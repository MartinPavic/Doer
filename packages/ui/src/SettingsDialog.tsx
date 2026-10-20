import { useState } from "react";
import { useDoer, useSetNotifyHere, useThisDevice, useUpdateProfile, type Profile, type QuietHours } from "@doer/core";
import { REMINDER_OFFSETS } from "./reminder-options";

const field = "rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent";

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
        className="w-full max-w-md space-y-5 rounded-3xl border border-line bg-surface p-6 shadow-2xl"
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
