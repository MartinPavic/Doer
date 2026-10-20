import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDoer } from "./provider";
import type { Task } from "./types";
import type { CreateProfileInput, CreateTaskInput, TaskView, UpdateProfileInput, UpdateTaskInput } from "./schemas";

export const useProfiles = () => {
  const { api } = useDoer();
  return useQuery({ queryKey: ["profiles"], queryFn: api.profiles.list });
};

export const useCreateProfile = () => {
  const { api } = useDoer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProfileInput) => api.profiles.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
};

/** Local-day boundaries; the server has no idea what timezone the user is in. */
function dayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStart: start.toISOString(), dayEnd: end.toISOString() };
}

export const useTasks = (profileId: string | null, view: TaskView) => {
  const { api } = useDoer();
  return useQuery({
    queryKey: ["tasks", profileId, view],
    enabled: !!profileId,
    queryFn: () => api.tasks.list(profileId!, { view, ...dayBounds() }),
  });
};

export const useTaskMutations = (profileId: string) => {
  const { api } = useDoer();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["reminders", profileId] }); // due-date changes re-time reminders
    return qc.invalidateQueries({ queryKey: ["tasks", profileId] });
  };
  return {
    create: useMutation({
      mutationFn: (input: CreateTaskInput) => api.tasks.create(profileId, input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) => api.tasks.update(profileId, id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.tasks.remove(profileId, id),
      onSuccess: invalidate,
    }),
  };
};

export const useUpdateProfile = () => {
  const { api } = useDoer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateProfileInput & { id: string }) => api.profiles.update(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profiles"] });
      void qc.invalidateQueries({ queryKey: ["reminders"] }); // quiet hours re-time pending reminders
    },
  });
};

export const useReminders = (profileId: string | null) => {
  const { api } = useDoer();
  return useQuery({
    queryKey: ["reminders", profileId],
    enabled: !!profileId,
    queryFn: () => api.reminders.list(profileId!),
  });
};

export const useReminderActions = (profileId: string) => {
  const { api } = useDoer();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["reminders"] });
  return {
    snooze: useMutation({
      mutationFn: ({ id, minutes }: { id: string; minutes: number }) => api.reminders.snooze(profileId, id, minutes),
      onSuccess: invalidate,
    }),
    dismiss: useMutation({ mutationFn: (id: string) => api.reminders.dismiss(profileId, id), onSuccess: invalidate }),
  };
};

/** Reminders that have fired but nobody has acted on yet, across all profiles (server keeps 24h). */
export const useDueReminders = () => {
  const { api } = useDoer();
  return useQuery({
    queryKey: ["reminders", "due"],
    queryFn: () => api.reminders.upcoming(),
    refetchInterval: 15_000,
    select: (all) => all.filter((r) => new Date(r.fireAt).getTime() <= Date.now()),
  });
};

/** Actions on a due reminder; unlike useReminderActions the profile is supplied per call. */
export const useAlertActions = () => {
  const { api } = useDoer();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["reminders"] });
    return qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  return {
    snooze: useMutation({
      mutationFn: ({ profileId, id, minutes }: { profileId: string; id: string; minutes: number }) =>
        api.reminders.snooze(profileId, id, minutes),
      onSuccess: refresh,
    }),
    dismiss: useMutation({
      mutationFn: ({ profileId, id }: { profileId: string; id: string }) => api.reminders.dismiss(profileId, id),
      onSuccess: refresh,
    }),
    done: useMutation({
      mutationFn: ({ profileId, taskId }: { profileId: string; taskId: string }) =>
        api.tasks.update(profileId, taskId, { status: "done" }),
      onSuccess: refresh,
    }),
  };
};

/** This install's server-side record (alerts on/off), registered on first use. */
export const useThisDevice = () => {
  const { api, platform } = useDoer();
  return useQuery({
    queryKey: ["device"],
    queryFn: async () => {
      const me = await platform.device();
      return api.devices.upsert(me.id, { kind: me.kind, label: me.label });
    },
  });
};

export const useSetNotifyHere = () => {
  const { api, platform } = useDoer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notifyHere: boolean) => {
      const me = await platform.device();
      const save = (on: boolean) => api.devices.upsert(me.id, { kind: me.kind, label: me.label, notifyHere: on });
      if (!platform.enablePush) return save(notifyHere); // desktop: the Rust scheduler honours the flag itself

      if (!notifyHere) {
        await Promise.allSettled([platform.disablePush?.(), api.push.unsubscribe(me.id)]);
        return save(false);
      }
      // The device row must exist before a subscription can be attached to it.
      await save(false);
      const { key } = await api.push.publicKey();
      if (!key) throw new Error("Push notifications aren't configured on the server yet.");
      const sub = await platform.enablePush(key);
      if (!sub) throw new Error("Notification permission was denied in the browser.");
      await api.push.subscribe(me.id, sub);
      return save(true);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["device"] }),
  });
};

/** Tasks for a calendar window. `enabled` lets the overlay skip profiles that are toggled off. */
export const useCalendarTasks = (profileId: string | null, range: { from: string; to: string } | null, enabled = true) => {
  const { api } = useDoer();
  return useQuery({
    queryKey: ["tasks", profileId, "calendar", range?.from, range?.to], // under "tasks" so task mutations refresh it
    enabled: !!profileId && !!range && enabled,
    queryFn: () => api.calendar.list(profileId!, range!.from, range!.to),
    placeholderData: (prev) => prev, // keep the old month on screen while the next one loads
  });
};

/** Calendar tasks of several profiles at once, each tagged with its profile id (for the overlay). */
export const useCalendarOverlay = (profileIds: string[], range: { from: string; to: string } | null, enabled: boolean) => {
  const { api } = useDoer();
  return useQueries({
    queries: profileIds.map((id) => ({
      queryKey: ["tasks", id, "calendar", range?.from, range?.to],
      enabled: enabled && !!range,
      queryFn: () => api.calendar.list(id, range!.from, range!.to),
      placeholderData: (prev: Task[] | undefined) => prev,
    })),
    combine: (results) => results.flatMap((r) => r.data ?? []),
  });
};
