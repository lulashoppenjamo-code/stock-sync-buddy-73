export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (window.self !== window.top) return; // inside Lovable preview iframe
  const host = window.location.hostname;
  const isLovablePreview = [
    host.startsWith("id-preview--"),
    host.startsWith("preview--"),
    host === "lovableproject.com" || host.endsWith(".lovableproject.com"),
    host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com"),
    host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev"),
  ].some(Boolean);
  if (isLovablePreview) {
    navigator.serviceWorker.getRegistrations().then((rs) =>
      rs.forEach((r) => { if (r.active?.scriptURL?.endsWith("/sw.js")) r.unregister(); })
    );
    return;
  }
  // Register in both dev and production
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[pwa] register failed", e));
}
