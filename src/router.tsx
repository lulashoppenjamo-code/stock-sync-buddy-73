import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Offline: no spamear reintentos; usar datos en caché de React Query
        retry: (count, err) => {
          if (typeof navigator !== "undefined" && !navigator.onLine) return false;
          return count < 2;
        },
        refetchOnWindowFocus: true,
        // Mantener datos previos útiles si la red falla
        networkMode: "offlineFirst",
        staleTime: 30_000,
        gcTime: 1000 * 60 * 60 * 24, // 24h en memoria
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
