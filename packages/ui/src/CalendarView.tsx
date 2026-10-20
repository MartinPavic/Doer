import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import rrulePlugin from "@fullcalendar/rrule";
import { RRule } from "rrule";
import type { DateSelectArg, DatesSetArg, EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import {
  useCalendarAccounts, useCalendarOverlay, useCalendarTasks, useDoer, useExternalEvents, useProfiles, useTaskMutations, useUiState,
  type ExternalEvent, type Profile, type Task,
} from "@doer/core";
import { ExternalEventDialog, NewTaskDialog, TaskDetailDialog, type NewTaskDraft } from "./CalendarDialogs";
import type { DateTimeValue } from "./DateTimePicker";

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const VIEWS = [
  { id: "dayGridMonth", label: "Month" },
  { id: "timeGridWeek", label: "Week" },
  { id: "timeGridDay", label: "Day" },
  { id: "listWeek", label: "Agenda" },
] as const;

/** External events are read-only and styled apart from tasks: tinted fill, solid left edge, normal text. */
function toExternalEvent(e: ExternalEvent): EventInput {
  const color = e.color ?? "#64748b";
  // All-day events are UTC-midnight dates: hand FullCalendar the bare date so no timezone shifts them.
  const day = (iso: string) => iso.slice(0, 10);
  return {
    id: `ext:${e.id}`,
    title: e.title,
    start: e.allDay ? day(e.startAt) : e.startAt,
    end: e.endAt ? (e.allDay ? day(e.endAt) : e.endAt) : undefined,
    allDay: e.allDay,
    editable: false,
    backgroundColor: `${color}30`,
    borderColor: color,
    textColor: "var(--fg)",
    classNames: ["doer-external"],
    extendedProps: { external: e },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Wall-clock string without an offset: the rrule plugin then repeats at the same local time across DST. */
const naiveLocal = (iso: string, allDay: boolean) => {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};

/**
 * One-off tasks become one event. A recurring task becomes an expanding series starting at its next
 * occurrence, plus a static, faded event for every occurrence already completed in the window.
 */
function toEvents(t: Task, profile: Profile, editable: boolean): EventInput[] {
  const start = t.startAt ?? t.dueAt;
  if (!start) return []; // unscheduled tasks live on the Tasks page
  const done = t.status === "done";
  const base: EventInput = {
    id: t.id,
    title: t.title,
    allDay: t.allDay,
    backgroundColor: profile.color,
    borderColor: profile.color,
    extendedProps: { task: t, profileId: profile.id },
  };
  if (!t.rrule || !t.dueAt) {
    return [{
      ...base,
      start,
      // A task with both start and due spans that range; otherwise it's a point in time.
      end: t.startAt && t.dueAt && t.dueAt > t.startAt ? t.dueAt : undefined,
      editable,
      classNames: [done ? "doer-done" : "", editable ? "" : "doer-overlay"],
    }];
  }
  const span = t.startAt ? new Date(t.dueAt).getTime() - new Date(t.startAt).getTime() : 0;
  return [
    {
      ...base,
      rrule: { ...RRule.parseString(t.rrule), dtstart: naiveLocal(t.dueAt, t.allDay) } as never,
      ...(span > 0 && !t.allDay && { duration: { milliseconds: span } }),
      editable: false, // moving one occurrence would silently move the whole series: use the 📅 editor
      classNames: [editable ? "" : "doer-overlay"],
    },
    ...(t.doneOccurrences ?? []).map((iso) => ({
      ...base,
      id: `${t.id}:${iso}`,
      start: iso,
      editable: false,
      classNames: ["doer-done", editable ? "" : "doer-overlay"],
      extendedProps: { task: t, profileId: profile.id, pastDone: true },
    })),
  ];
}

export function CalendarView({ profile }: { profile: Profile }) {
  const calendar = useRef<FullCalendar>(null);
  const view = useUiState((s) => s.calendarView);
  const setView = useUiState((s) => s.setCalendarView);
  const overlay = useUiState((s) => s.overlayOthers);
  const setOverlay = useUiState((s) => s.setOverlayOthers);
  const { data: profiles = [] } = useProfiles();
  const others = useMemo(() => profiles.filter((p) => p.id !== profile.id), [profiles, profile.id]);

  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { data: own = [] } = useCalendarTasks(profile.id, range);
  const overlayTasks = useCalendarOverlay(others.map((p) => p.id), range, overlay);
  const { data: externalOwn = [] } = useExternalEvents(profile.id, range);
  const { data: accounts = [] } = useCalendarAccounts(profile.id);
  const { platform } = useDoer();
  const { create, update, remove } = useTaskMutations(profile.id);
  const [selectedExternal, setSelectedExternal] = useState<ExternalEvent | null>(null);

  const [selected, setSelected] = useState<{ task: Task; occurrence: Date | null; pastDone: boolean } | null>(null);
  const [draft, setDraft] = useState<{ due: DateTimeValue; end: Date | null } | null>(null);

  const events = useMemo(() => {
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return [
      ...externalOwn.map(toExternalEvent),
      ...own.flatMap((t) => toEvents(t, profile, true)),
      ...overlayTasks.flatMap((t) => { const p = byId.get(t.profileId); return p ? toEvents(t, p, false) : []; }),
    ];
  }, [own, externalOwn, overlayTasks, profile, profiles]);

  const taskOf = (e: { extendedProps: Record<string, unknown> }) => e.extendedProps.task as Task;

  // Dragging/resizing moves the task: a task with a start keeps start→due as its span, otherwise start is the due time.
  function reschedule(info: EventDropArg | EventResizeDoneArg) {
    const t = taskOf(info.event);
    const { start, end, allDay } = info.event;
    if (!start) return info.revert();
    const spans = !!t.startAt || (!!end && end.getTime() > start.getTime() && !allDay);
    update.mutate(
      {
        id: t.id,
        allDay,
        tz: localTz(),
        ...(spans && end ? { startAt: start.toISOString(), dueAt: end.toISOString() } : { dueAt: start.toISOString() }),
      },
      { onError: () => info.revert() },
    );
  }

  function onSelect(info: DateSelectArg) {
    calendar.current?.getApi().unselect();
    // A single click in the week/day grid selects one slot: treat it as a point in time, not a range.
    const dragged = !info.allDay && info.end.getTime() - info.start.getTime() > 30 * 60_000;
    setDraft({ due: { date: info.start, allDay: info.allDay, rrule: null }, end: dragged ? info.end : null });
  }

  function createFromDraft({ title, due, end }: NewTaskDraft) {
    if (!due.date) return;
    const spans = end && !due.allDay && due.date.getTime() === draft?.due.date?.getTime();
    create.mutate(
      {
        title,
        dueAt: (spans ? end : due.date).toISOString(),
        ...(spans && { startAt: due.date.toISOString() }),
        allDay: due.allDay,
        tz: localTz(),
        ...(due.rrule && { rrule: due.rrule }),
      },
      { onSuccess: () => setDraft(null) },
    );
  }

  const selectedProfile = selected && (profiles.find((p) => p.id === selected.task.profileId) ?? profile);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => { setView(v.id); calendar.current?.getApi().changeView(v.id); }}
              className={`rounded-lg px-3 py-1 text-sm font-medium transition ${view === v.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
            Show {others.map((p) => p.name).join(", ")}
          </label>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
        <FullCalendar
          ref={calendar}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, rrulePlugin]}
          initialView={view}
          headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
          firstDay={1}
          height="calc(100vh - 14rem)"
          expandRows
          nowIndicator
          selectable
          selectMirror
          editable
          eventStartEditable
          eventDurationEditable
          dayMaxEvents={3}
          defaultTimedEventDuration="00:30"
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          scrollTime="08:00:00"
          events={events}
          datesSet={(a: DatesSetArg) => setRange({ from: a.start.toISOString(), to: a.end.toISOString() })}
          select={onSelect}
          eventClick={(info) => {
            const ext = info.event.extendedProps.external as ExternalEvent | undefined;
            if (ext) return setSelectedExternal(ext);
            setSelected({
              task: taskOf(info.event),
              occurrence: info.event.start,
              pastDone: !!info.event.extendedProps.pastDone,
            });
          }}
          eventDrop={reschedule}
          eventResize={reschedule}
        />
      </div>

      {draft && (
        <NewTaskDialog
          profile={profile}
          initial={draft}
          onCreate={createFromDraft}
          onClose={() => setDraft(null)}
        />
      )}
      {selectedExternal && (
        <ExternalEventDialog
          event={selectedExternal}
          calendarName={accounts.flatMap((a) => a.calendars).find((cal) => cal.id === selectedExternal.calendarId)?.name}
          onOpenLink={(url) => void platform.openExternal(url)}
          onClose={() => setSelectedExternal(null)}
        />
      )}
      {selected && selectedProfile && (
        <TaskDetailDialog
          task={selected.task}
          occurrence={selected.occurrence}
          pastDone={selected.pastDone}
          profile={selectedProfile}
          readOnly={selected.task.profileId !== profile.id}
          canMirror={accounts.some((a) => a.calendars.some((cal) => cal.isWriteTarget && cal.writable))}
          onSetMirror={(mirror) => {
            update.mutate({ id: selected.task.id, mirror });
            setSelected({ ...selected, task: { ...selected.task, mirror } });
          }}
          onToggleDone={(done) => {
            update.mutate({ id: selected.task.id, status: done ? "done" : "todo" });
            // A recurring task jumps to its next occurrence, so the dialog's subject is gone.
            if (selected.task.rrule) setSelected(null);
            else setSelected({ ...selected, task: { ...selected.task, status: done ? "done" : "todo" } });
          }}
          onDelete={() => remove.mutate(selected.task.id, { onSuccess: () => setSelected(null) })}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
