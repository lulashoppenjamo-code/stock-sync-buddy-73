import { useEffect, useState } from "react";

export function useOnline() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function usePendingCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const { pendingCount } = await import("@/lib/offline-queue");
        const c = await pendingCount();
        if (mounted) setCount(c);
      } catch {
        // ignore
      } finally {
        refreshing = false;
      }
    };
    refresh();
    const handler = () => { void refresh(); };
    window.addEventListener("inv:queue-changed", handler);
    // Refresco más frecuente mientras haya pendientes
    const i = window.setInterval(refresh, 5_000);
    return () => {
      mounted = false;
      window.removeEventListener("inv:queue-changed", handler);
      window.clearInterval(i);
    };
  }, []);
  return count;
}
