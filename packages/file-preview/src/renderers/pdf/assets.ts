// The binary files the PDF library asks for while it parses: character maps for
// fonts that aren't embedded, the standard font files and the image
// decoders. Vite emits each as its own hashed file, fetched only when a
// document needs it, so the library gets them from this factory by name instead
// of from a directory URL.

const cMaps = import.meta.glob<string>(
  "../../../node_modules/pdfjs-dist/cmaps/*.bcmap",
  { query: "?url&no-inline", import: "default", eager: true },
);
const standardFonts = import.meta.glob<string>(
  "../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  { query: "?url&no-inline", import: "default", eager: true },
);
const wasm = import.meta.glob<string>(
  "../../../node_modules/pdfjs-dist/wasm/*.wasm",
  { query: "?url&no-inline", import: "default", eager: true },
);

function byName(files: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) {
    map.set(path.slice(path.lastIndexOf("/") + 1), url);
  }
  return map;
}

const ASSETS: Record<string, Map<string, string>> = {
  cMapUrl: byName(cMaps),
  standardFontDataUrl: byName(standardFonts),
  wasmUrl: byName(wasm),
};

/** Asset URL for a PDF library binary-data request, or null when unknown. */
export function pdfAssetUrl(kind: string, filename: string): string | null {
  return ASSETS[kind]?.get(filename) ?? null;
}

/**
 * Passed to `getDocument` as `BinaryDataFactory`: the library constructs it and
 * calls `fetch({ kind, filename })` for each file it needs.
 */
export class PdfAssetFactory {
  async fetch({
    kind,
    filename,
  }: {
    kind: string;
    filename: string;
  }): Promise<Uint8Array> {
    const url = pdfAssetUrl(kind, filename);
    if (!url) throw new Error(`Unknown PDF asset: ${kind} ${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
