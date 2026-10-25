import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "autoUpdate",
        injectRegister: null,
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
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}"],
          globIgnores: ["**/node_modules/**", "**/server/**", "**/api/**"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          rollupFormat: "es",
          // TanStack Start / Lovable empaqueta el cliente bajo "client/" en el build,
          // pero en el navegador se sirve como "/assets/...", "/offline.html", etc.
          // Sin esto el precache no coincide y la app NO abre offline.
          modifyURLPrefix: {
            "client/": "/",
          },
          manifestTransforms: [
            async (entries) => {
              const manifest = entries.map((entry) => {
                let url = entry.url;
                if (url.startsWith("client/")) url = url.slice("client/".length);
                if (!url.startsWith("/")) url = `/${url}`;
                return { ...entry, url };
              });
              return { manifest, warnings: [] };
            },
          ],
        },
      }),
    ],
  },
});
