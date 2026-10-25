import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        devOptions: { enabled: false },
        filename: "sw.js",
        includeAssets: ["favicon-192.png", "pwa-192.png", "pwa-512.png", "offline.html"],
        manifest: {
          name: "Inventario A/B",
          short_name: "Inventario",
          description: "Gestión de inventario con auditoría y traspasos entre sucursales.",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait-primary",
          start_url: "/",
          scope: "/",
          lang: "es",
          icons: [
            { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Más seguro con TanStack Start: no forzar precache de todo el build
          globPatterns: ["**/*.{ico,png,svg,woff,woff2,webmanifest}"],
          globIgnores: ["**/node_modules/**", "**/server/**"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallbackDenylist: [/^\/\~oauth/, /^\/api\//, /^\/rest\//],
          additionalManifestEntries: [{ url: "/offline.html", revision: "5" }],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "html-pages",
                networkTimeoutSeconds: 3,
                plugins: [
                  {
                    handlerDidError: async () => {
                      const fallback = await self.caches.match("/offline.html");
                      return fallback || Response.error();
                    },
                  },
                ],
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\.(?:js|css|woff2?)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "static-assets",
                expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\.(?:png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "images",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /\/rest\/v1\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "supabase-rest",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
          ],
        },
      }),
    ],
  },
}); 