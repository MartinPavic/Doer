import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { createApiClient, type ApiClient, type ApiClientOptions } from "./api-client";
import type { Platform } from "./platform";

interface DoerContext {
  platform: Platform;
  api: ApiClient;
  auth: ReturnType<typeof createAuthClient>;
}
const Ctx = createContext<DoerContext | null>(null);

export function DoerProvider({
  platform,
  baseUrl,
  getToken,
  setToken,
  wrapApi,
  children,
}: ApiClientOptions & {
  platform: Platform;
  /** Lets a shell decorate the API (desktop adds the offline cache + outbox). */
  wrapApi?: (api: ApiClient) => ApiClient;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      platform,
      api: wrapApi ? wrapApi(createApiClient({ baseUrl, getToken })) : createApiClient({ baseUrl, getToken }),
      auth: createAuthClient({
        baseURL: baseUrl || window.location.origin,
        basePath: "/api/auth",
        fetchOptions: {
          credentials: "include",
          // Desktop: cookies don't survive the tauri:// origin, so ride on the bearer token instead.
          ...(getToken && {
            auth: { type: "Bearer" as const, token: async () => (await getToken()) ?? "" },
            onSuccess: async (ctx) => {
              const issued = ctx.response.headers.get("set-auth-token");
              if (issued) await setToken?.(issued);
              else if (new URL(ctx.response.url).pathname.endsWith("/sign-out")) await setToken?.(null);
            },
          }),
        },
      }),
    }),
    [platform, baseUrl, getToken, setToken, wrapApi],
  );
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, refetchInterval: 30_000 } } }),
    [],
  );
  // Other windows (desktop bubble <-> main) announce writes; refetch when they do, and announce ours.
  useEffect(() => {
    const unsubscribe = platform.subscribe?.("data:changed", () => void queryClient.invalidateQueries());
    const stop = queryClient.getMutationCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "success") void platform.broadcast?.("data:changed");
    });
    return () => {
      stop();
      void unsubscribe?.then((off) => off());
    };
  }, [platform, queryClient]);

  return (
    <Ctx.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Ctx.Provider>
  );
}

export function useDoer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("DoerProvider missing");
  return v;
}
