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
        // Deja que el plugin inyecte el registro (más fiable que solo el manual)
        injectRegister: "auto",
        strategies: "generateSW",
        filename: "sw.js",
        devOptions: { enabled: false },
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
            { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Precache assets estáticos del build + offline.html
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}"],
          globIgnores: ["**/node_modules/**", "**/server/**", "**/api/**"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          // Si una navegación falla sin red → offline.html
          navigateFallback: "/offline.html",
          navigateFallbackAllowlist: [/./],
          navigateFallbackDenylist: [/^\/\~oauth/, /^\/api\//, /^\/rest\//],
          additionalManifestEntries: [{ url: "/offline.html", revision: "6" }],
          runtimeCaching: [
            // Documentos HTML: guarda los que cargaste online para reusarlos offline
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "pages",
                networkTimeoutSeconds: 3,
                cacheableResponse: { statuses: [0, 200] },
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\.(?:js|css)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "static-assets",
                cacheableResponse: { statuses: [0, 200] },
                expiration: {
                  maxEntries: 150,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "images-fonts",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
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