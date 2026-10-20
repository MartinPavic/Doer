import { createContext, useContext, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { createApiClient, type ApiClientOptions } from "./api-client";
import type { Platform } from "./platform";

interface DoerContext {
  platform: Platform;
  api: ReturnType<typeof createApiClient>;
  auth: ReturnType<typeof createAuthClient>;
}
const Ctx = createContext<DoerContext | null>(null);

export function DoerProvider({
  platform,
  baseUrl,
  getToken,
  children,
}: ApiClientOptions & { platform: Platform; children: ReactNode }) {
  const value = useMemo(
    () => ({
      platform,
      api: createApiClient({ baseUrl, getToken }),
      auth: createAuthClient({
        baseURL: baseUrl || window.location.origin,
        basePath: "/api/auth",
        fetchOptions: { credentials: "include" },
      }),
    }),
    [platform, baseUrl, getToken],
  );
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, refetchInterval: 30_000 } } }),
    [],
  );
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
