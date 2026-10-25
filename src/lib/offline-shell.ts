/**
 * Calienta la caché del app shell mientras hay internet.
 * Prioriza /app/audit (conteo) para que abra offline.
 */
const SHELL_CACHE = "app-shell-v1";

async function putInCache(cache: Cache, url: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "reload" });
    if (res.ok) {
      await cache.put(url, res.clone());
    }
  } catch {
    // ignore
  }
}

export async function warmAppShell(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("caches" in window)) return;
  if (!navigator.onLine) return;

  try {
    const cache = await caches.open(SHELL_CACHE);

    // Orden: auditoría primero (lo que más se usa offline)
    const paths = [
      "/app/audit",
      "/app",
      "/",
      "/app/history",
      "/app/audit-history",
      "/offline.html",
      "/manifest.webmanifest",
      window.location.pathname || "/",
    ];

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

    const html = document.documentElement.outerHTML;
    const re = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      assets.add(new URL(m[0], window.location.origin).href);
    }

    // Forzar chunks críticos de auditoría si están en el precache del SW
    const critical = [
      "/assets/app.audit",
      "/assets/BarcodeScanner",
    ];
    // No conocemos el hash; el SW ya precachea app.audit-*.js

    await Promise.all([...assets].map((url) => putInCache(cache, url)));
    console.info("[offline-shell] cached pages +", assets.size, "assets (audit prioritario)");
  } catch (e) {
    console.warn("[offline-shell] warm failed", e);
  }
}

export function startShellWarm(): () => void {
  if (typeof window === "undefined") return () => {};

  const run = () => {
    window.setTimeout(() => {
      warmAppShell().catch(() => {});
    }, 1500);
    window.setTimeout(() => {
      warmAppShell().catch(() => {});
    }, 6000);
  };

  if (navigator.onLine) run();
  window.addEventListener("online", run);

  const onMsg = (ev: MessageEvent) => {
    if (ev.data?.type === "SW_ACTIVATED" && navigator.onLine) run();
  };
  navigator.serviceWorker?.addEventListener("message", onMsg);

  // Si el usuario entra a Auditoría online, recalentar al instante
  const onNav = () => {
    if (navigator.onLine && /\/app\/audit/.test(window.location.pathname)) {
      warmAppShell().catch(() => {});
    }
  };
  window.addEventListener("popstate", onNav);

  return () => {
    window.removeEventListener("online", run);
    window.removeEventListener("popstate", onNav);
    navigator.serviceWorker?.removeEventListener("message", onMsg);
  };
}
