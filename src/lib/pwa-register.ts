// Register the service worker only outside Lovable preview/dev.
export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("sw") === "off") {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    return;
  }
  if (window.self !== window.top) return; // inside iframe (Lovable preview)
  const host = window.location.hostname;
  const refused = [
    host.startsWith("id-preview--"),
    host.startsWith("preview--"),
    host === "lovableproject.com" || host.endsWith(".lovableproject.com"),
    host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com"),
    host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev"),
  ].some(Boolean);
  if (refused) {
    navigator.serviceWorker.getRegistrations().then((rs) =>
      rs.forEach((r) => {
        if (r.active?.scriptURL?.endsWith("/sw.js")) r.unregister();
      }),
    );
    return;
  }
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[pwa] register failed", e));
}
