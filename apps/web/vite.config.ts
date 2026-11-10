import path from "node:path";
import babel from "@rolldown/plugin-babel";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import packageJson from "../../package.json";
import {
  DESKTOP_DISCOVERY_FILE,
  desktopDiscoveryDocument,
} from "./src/lib/desktop-discovery";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const uploadSourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject);

/**
 * Serves and emits /.well-known/margaya-desktop.json from VITE_API_URL, so the
 * desktop app can find a separately hosted API from the web address.
 */
function desktopDiscovery(): Plugin {
  let document: string | null = null;
  return {
    name: "margaya-desktop-discovery",
    configResolved(config) {
      document = desktopDiscoveryDocument(config.env.VITE_API_URL);
    },
    configureServer(server) {
      server.middlewares.use(
        `/${DESKTOP_DISCOVERY_FILE}`,
        (_req, res, next) => {
          if (!document) return next();
          res.setHeader("Content-Type", "application/json");
          res.end(document);
        },
      );
    },
    generateBundle() {
      if (!document) return;
      this.emitFile({
        type: "asset",
        fileName: DESKTOP_DISCOVERY_FILE,
        source: document,
      });
    },
  };
}

const dependency = (names: string) =>
  new RegExp(`[\\\\/]node_modules[\\\\/](?:${names})[\\\\/]`);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  base: "/",
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      // Keep co-located route tests out of the generated route tree.
      routeFileIgnorePattern: "\\.test\\.tsx?$",
    }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    desktopDiscovery(),
    // Hidden when Sentry env vars are absent so local dev does not depend on it.
    ...(uploadSourceMaps
      ? [
          sentryVitePlugin({
            authToken: sentryAuthToken,
            org: sentryOrg,
            project: sentryProject,
            release: { name: packageJson.version },
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  server: {
    host: true,
    // The e2e suite turns HMR off: an edit to the working tree mid-run would
    // otherwise hot-update or reload the pages under test.
    hmr: process.env.MARGAYA_DISABLE_HMR !== "true",
    port: 5173,
  },
  optimizeDeps: {
    exclude: ["better-auth"],
  },
  ssr: {
    noExternal: ["better-auth"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@i18n": path.resolve(__dirname, "../../i18n"),
    },
  },
  build: {
    // Generate maps only for private symbolication, then delete after upload.
    // "hidden" alone still writes publicly servable .map files.
    sourcemap: uploadSourceMaps ? "hidden" : false,
    rolldownOptions: {
      output: {
        // By default every set of modules that the first page shares with a
        // different mix of lazy routes became a chunk of its own: a cold load
        // fetched several hundred files, most under 2 KB. The groups tagged
        // $initial take only what the first page imports statically, so routes
        // and per-language translations still load on demand. Dependencies sit
        // apart from app code (and import nothing from it), so an app release
        // leaves them cached.
        codeSplitting: {
          groups: [
            {
              name: "react",
              tags: ["$initial"],
              priority: 6,
              // Vite's own helpers (\0 ids) are imported by nearly every chunk.
              test: (id) =>
                id.startsWith("\0") ||
                dependency(
                  "react|react-dom|scheduler|use-sync-external-store",
                ).test(id),
            },
            {
              // Every icon in use, lazy routes' too: about 300 tiny modules
              // that otherwise spread over a hundred chunks.
              name: "icons",
              priority: 5,
              test: dependency("lucide-react"),
            },
            {
              name: "router",
              tags: ["$initial"],
              priority: 4,
              test: dependency("@tanstack"),
            },
            {
              name: "ui-kit",
              tags: ["$initial"],
              priority: 3,
              test: dependency("@base-ui|@floating-ui|tabbable"),
            },
            {
              name: "vendor",
              tags: ["$initial"],
              priority: 2,
              test: /[\\/]node_modules[\\/]/,
            },
            {
              name: "app",
              tags: ["$initial"],
              priority: 1,
              test: (id) => !id.endsWith(".html"),
            },
          ],
        },
      },
    },
    commonjsOptions: {
      include: [/better-auth/, /node_modules/],
      transformMixedEsModules: true,
    },
    target: "esnext",
  },
});
