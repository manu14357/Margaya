// Route code splitting (the router's Vite plugin) gives each route file
// importers like `const $$splitComponentImporter = () => import("…?tsr-split=component")`.
// The router offers no hook around them, so the build wraps each one in
// retryChunk (lib/chunk-load.ts): a chunk that fails to fetch is tried again,
// and one that never loads shows the route's error screen with a reload
// prompt instead of a silent full-page reload.

const SPLIT_IMPORTER =
  /(\$\$split\w*Importer\s*=\s*)\(\)\s*=>\s*(import\(\s*(["'`])[^"'`]*[?&]tsr-split=[^"'`]*\3\s*\))/g;

const RETRY = "__margayaRetryChunk";

/**
 * Wraps a route file's split importers in retryChunk; null when it has none.
 * Runs on the router plugin's output, before TypeScript is stripped.
 */
export function wrapRouteChunkImporters(code: string): string | null {
  let wrapped = 0;
  const result = code.replace(SPLIT_IMPORTER, (_match, head, load) => {
    wrapped++;
    return `${head}() => ${RETRY}(() => ${load})`;
  });
  if (wrapped === 0) return null;
  return `import { retryChunk as ${RETRY} } from "@/lib/chunk-load";\n${result}`;
}
