/**
 * Calienta la caché del app shell mientras hay internet.
 * Guarda el HTML actual y todos los <script>/<link> para poder abrir la app offline.
 */
const SHELL_CACHE = "app-shell-v1";

async function putInCache(cache: Cache, url: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
    if (res.ok) {
      await cache.put(url, res.clone());
    }
  } catch {
    // sin red o fallo puntual: ignorar
  }
}

/** Cachea la página actual + scripts + CSS visibles en el DOM. */
export async function warmAppShell(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("caches" in window)) return;
  if (!navigator.onLine) return;

  try {
    const cache = await caches.open(SHELL_CACHE);

    // Documento actual (rutas principales)
    const paths = new Set<string>([
      window.location.pathname || "/",
      "/",
      "/app",
      "/app/audit",
      "/app/history",
      "/app/audit-history",
      "/offline.html",
    ]);

    for (const path of paths) {
      await putInCache(cache, new URL(path, window.location.origin).href);
    }

    // Scripts y estilos ya cargados en la página
    const assets = new Set<string>();
    document.querySelectorAll("script[src]").forEach((el) => {
      const src = (el as HTMLScriptElement).src;
      if (src && src.startsWith(window.location.origin)) assets.add(src);
    });
    document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
      const href = (el as HTMLLinkElement).href;
      if (href && href.startsWith(window.location.origin)) assets.add(href);
    });
    document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"]').forEach((el) => {
      const href = (el as HTMLLinkElement).href;
      if (href && href.startsWith(window.location.origin)) assets.add(href);
    });

    await Promise.all([...assets].map((url) => putInCache(cache, url)));
  } catch (e) {
    console.warn("[offline-shell] warm failed", e);
  }
}

/** Arranca calentamiento al cargar y al volver online. */
export function startShellWarm(): () => void {
  if (typeof window === "undefined") return () => {};

  const run = () => {
    // Dar tiempo a que hidrate y cargue chunks
    window.setTimeout(() => {
      warmAppShell().catch(() => {});
    }, 2500);
  };

  if (navigator.onLine) run();
  window.addEventListener("online", run);

  // También cuando el SW avisa que está activo
  const onMsg = (ev: MessageEvent) => {
    if (ev.data?.type === "SW_ACTIVATED" && navigator.onLine) run();
  };
  navigator.serviceWorker?.addEventListener("message", onMsg);

  return () => {
    window.removeEventListener("online", run);
    navigator.serviceWorker?.removeEventListener("message", onMsg);
  };
}
