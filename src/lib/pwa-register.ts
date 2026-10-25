export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // No registrar dentro del iframe de preview de Lovable
  if (window.self !== window.top) return;

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
      rs.forEach((r) => {
        if (r.active?.scriptURL?.endsWith("/sw.js")) r.unregister();
      })
    );
    return;
  }

  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      // Cuando hay una versión nueva del SW, forzar que se active
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            // Nueva versión lista; skipWaiting ya está en workbox
            console.info("[pwa] Nueva versión disponible");
          }
        });
      });
    })
    .catch((e) => console.warn("[pwa] register failed", e));
}