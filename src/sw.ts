/// <reference lib="webworker" />
/**
 * Service Worker custom — app shell offline + sync al recuperar red.
 * Estrategia: cachear navegaciones y assets en la 1ª visita online;
 * sin red servir desde caché; si no hay nada → offline.html.
 */
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

const ORIGIN = self.location.origin;

// ── Navegaciones (HTML de la app) ─────────────────────────────────────
registerRoute(
  ({ request }) => request.mode === "navigate",
  async (ctx) => {
    const networkFirst = new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 3,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 14 }),
      ],
    });
    try {
      return await networkFirst.handle(ctx);
    } catch {
      const url = new URL(ctx.request.url);
      const candidates = [
        ctx.request,
        url.pathname,
        "/",
        "/index.html",
        "/offline.html",
      ];
      for (const c of candidates) {
        const hit = await caches.match(c, { ignoreSearch: true });
        if (hit) return hit;
      }
      // Buscar cualquier documento cacheado de este origen
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.headers.get("accept")?.includes("text/html") || req.mode === "navigate") {
            const res = await cache.match(req);
            if (res) return res;
          }
        }
      }
      const offline = await caches.match("/offline.html");
      return offline || Response.error();
    }
  },
);

// ── JS / CSS del mismo origen ─────────────────────────────────────────
registerRoute(
  ({ url, request }) =>
    url.origin === ORIGIN &&
    (request.destination === "script" ||
      request.destination === "style" ||
      /\.(?:js|css|mjs)$/.test(url.pathname)),
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// ── Imágenes y fuentes ────────────────────────────────────────────────
registerRoute(
  ({ url, request }) =>
    url.origin === ORIGIN &&
    (request.destination === "image" ||
      request.destination === "font" ||
      /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)),
  new CacheFirst({
    cacheName: "images-fonts",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// ── Resto GET mismo origen (chunks, data, etc.) ───────────────────────
registerRoute(
  ({ url, request }) => url.origin === ORIGIN && request.method === "GET",
  new StaleWhileRevalidate({
    cacheName: "origin-misc",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// Al recuperar red: avisar a las pestañas para drenar cola offline
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "SW_ACTIVATED" });
      }
    })(),
  );
});
