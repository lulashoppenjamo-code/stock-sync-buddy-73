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
        includeAssets: [
          "favicon-192.png",
          "pwa-192.png",
          "pwa-512.png",
          "offline.html",
        ],
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
            {
              src: "/pwa-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // Precache del esqueleto de la app (HTML/JS/CSS/iconos generados en el build)
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}"],
          // Evita precachear cosas de servidor / APIs
          globIgnores: ["**/node_modules/**", "**/server/**", "**/api/**"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallback: "/offline.html",
          navigateFallbackDenylist: [/^\/\~oauth/, /^\/api\//, /^\/rest\//],
          additionalManifestEntries: [{ url: "/offline.html", revision: "4" }],
          runtimeCaching: [
            // Navegación: red primero; si falla → offline.html
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "html-pages",
                networkTimeoutSeconds: 4,
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
            // JS / CSS / fuentes del mismo origen
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\.(?:js|css|woff2?)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "static-assets",
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
            // Imágenes
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\.(?:png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "images",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
            // Supabase REST: red primero, cache corto de respaldo
            {
              urlPattern: /\/rest\/v1\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "supabase-rest",
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24,
                },
              },
            },
          ],
        },
      }),
    ],
  },
});