import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDoer } from "./provider";
import type { CreateProfileInput, CreateTaskInput, TaskView, UpdateTaskInput } from "./schemas";

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
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks", profileId] });
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
