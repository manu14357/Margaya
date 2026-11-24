import { describe, expect, it } from "vitest";
import { wrapRouteChunkImporters } from "./route-chunk-retry";

// The shape the router's code splitter writes into a route file.
const routeFile = [
  `import { lazyRouteComponent } from '@tanstack/react-router';`,
  `const $$splitErrorComponentImporter = () => import('/src/routes/board.tsx?tsr-split=errorComponent');`,
  `const $$splitComponentImporter = () => import('/src/routes/board.tsx?tsr-split=component');`,
  `export const Route = createFileRoute('/board')({`,
  `  component: lazyRouteComponent($$splitComponentImporter, 'component'),`,
  `  errorComponent: lazyRouteComponent($$splitErrorComponentImporter, 'errorComponent'),`,
  "});",
].join("\n");

describe("wrapRouteChunkImporters", () => {
  it("wraps every split importer in retryChunk", () => {
    const result = wrapRouteChunkImporters(routeFile);
    expect(result).toContain(
      `import { retryChunk as __margayaRetryChunk } from "@/lib/chunk-load";`,
    );
    expect(result).toContain(
      `const $$splitComponentImporter = () => __margayaRetryChunk(() => import('/src/routes/board.tsx?tsr-split=component'));`,
    );
    expect(result).toContain(
      `const $$splitErrorComponentImporter = () => __margayaRetryChunk(() => import('/src/routes/board.tsx?tsr-split=errorComponent'));`,
    );
    // The router's own calls are untouched.
    expect(result).toContain(
      `component: lazyRouteComponent($$splitComponentImporter, 'component')`,
    );
  });

  it("accepts double quotes and other spacing", () => {
    const result = wrapRouteChunkImporters(
      `const $$splitComponentImporter=()=>import("/r.tsx?tsr-split=component");`,
    );
    expect(result).toContain(
      `() => __margayaRetryChunk(() => import("/r.tsx?tsr-split=component"))`,
    );
  });

  it("leaves files without split importers alone", () => {
    expect(
      wrapRouteChunkImporters(`const load = () => import("./other");`),
    ).toBeNull();
  });
});
