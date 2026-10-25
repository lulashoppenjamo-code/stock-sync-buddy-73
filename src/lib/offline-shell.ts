/**
 * Calienta la caché del app shell mientras hay internet.
 * Guarda el HTML actual y todos los <script>/<link> para poder abrir la app offline.
 */
const SHELL_CACHE = "app-shell-v1";

async function putInCache(cache: Cache, url: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "reload" });
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

    const paths = new Set<string>([
      window.location.pathname || "/",
      "/",
      "/app",
      "/app/audit",
      "/app/history",
      "/app/audit-history",
      "/offline.html",
      "/manifest.webmanifest",
    ]);

    for (const path of paths) {
      await putInCache(cache, new URL(path, window.location.origin).href);
    }

    const assets = new Set<string>();
    document.querySelectorAll("script[src]").forEach((el) => {
      const src = (el as HTMLScriptElement).src;
      if (src && src.startsWith(window.location.origin)) assets.add(src);
    });
    document.querySelectorAll(
      'link[rel="stylesheet"], link[rel="modulepreload"], link[rel="preload"], link[rel="manifest"]',
    ).forEach((el) => {
      const href = (el as HTMLLinkElement).href;
      if (href && href.startsWith(window.location.origin)) assets.add(href);
    });

    // También cualquier /assets/* que aparezca en el HTML
    const html = document.documentElement.outerHTML;
    const re = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      assets.add(new URL(m[0], window.location.origin).href);
    }

    await Promise.all([...assets].map((url) => putInCache(cache, url)));
    console.info("[offline-shell] cached", paths.size, "pages +", assets.size, "assets");
  } catch (e) {
    console.warn("[offline-shell] warm failed", e);
  }
}

/** Arranca calentamiento al cargar y al volver online. */
export function startShellWarm(): () => void {
  if (typeof window === "undefined") return () => {};

  const run = () => {
    window.setTimeout(() => {
      warmAppShell().catch(() => {});
    }, 2000);
    // Segunda pasada por si cargan chunks tarde
    window.setTimeout(() => {
      warmAppShell().catch(() => {});
    }, 8000);
  };

  if (navigator.onLine) run();
  window.addEventListener("online", run);

  const onMsg = (ev: MessageEvent) => {
    if (ev.data?.type === "SW_ACTIVATED" && navigator.onLine) run();
  };
  navigator.serviceWorker?.addEventListener("message", onMsg);

  return () => {
    window.removeEventListener("online", run);
    navigator.serviceWorker?.removeEventListener("message", onMsg);
  };
}
