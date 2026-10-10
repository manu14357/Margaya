import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/**
 * The site ships as a static export. `next dev` enforces the export rules by
 * throwing, which answers HTTP 500 for any dynamic path that is not in
 * generateStaticParams (for example /anything-unknown via app/[slug]). The dev
 * server therefore runs as a regular server, where `dynamicParams = false`
 * answers 404 exactly like the exported files; `next build` still exports.
 *
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function nextConfig(phase) {
  return {
    output: phase === PHASE_DEVELOPMENT_SERVER ? undefined : "export",
    images: {
      unoptimized: true,
    },
    reactStrictMode: true,
    // @margaya/landing ships TypeScript source; Next compiles it with the app.
    transpilePackages: ["@margaya/landing"],
  };
}
