/**
 * Calienta la caché del app shell mientras hay internet.
 * Prioriza Auditoría, Historial/Reporte e Traspasos para uso offline.
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

    const paths = [
      "/app/audit",
      "/app/audit-history",
      "/app/transfer",
      "/app/history",
      "/app",
      "/",
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

    await Promise.all([...assets].map((url) => putInCache(cache, url)));
    console.info("[offline-shell] cached critical pages +", assets.size, "assets");
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

  const onNav = () => {
    if (!navigator.onLine) return;
    const p = window.location.pathname;
    if (/\/app\/(audit|audit-history|transfer|history)/.test(p)) {
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
