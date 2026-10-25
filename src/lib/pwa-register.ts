export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
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
        if (r.active?.scriptURL?.includes("sw.js") || r.active?.scriptURL?.includes("sw.ts")) {
          r.unregister();
        }
      }),
    );
    return;
  }

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(async (reg) => {
      console.info("[pwa] SW registrado", reg.scope);
      await reg.update().catch(() => {});

      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    })
    .catch((e) => console.warn("[pwa] register failed", e));
}
