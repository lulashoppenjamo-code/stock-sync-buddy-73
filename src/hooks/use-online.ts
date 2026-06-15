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
    const refresh = async () => {
      const { pendingCount } = await import("@/lib/offline-queue");
      const c = await pendingCount();
      if (mounted) setCount(c);
    };
    refresh();
    const handler = () => refresh();
    window.addEventListener("inv:queue-changed", handler);
    const i = window.setInterval(refresh, 10_000);
    return () => {
      mounted = false;
      window.removeEventListener("inv:queue-changed", handler);
      window.clearInterval(i);
    };
  }, []);
  return count;
}
