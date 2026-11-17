// Bold, italic, underline, alignment and font colour for XLSX cells. The
// community build of the spreadsheet parser keeps only fills on cells, so
// this reads the style table and each sheet's cell style indexes itself.
// It's an extra, bounded pass: a sheet too large to scan just keeps the
// default look.

export type CellLook = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
};

/** Per sheet name: "row,col" → look. */
export type SheetLooks = Map<string, Map<string, CellLook>>;

const MAX_SHEET_XML = 30 * 1024 * 1024;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
}

/** "BC12" → [11, 54]. */
export function decodeCellRef(ref: string): [number, number] | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  const [, letters, digits] = match ?? [];
  if (!letters || !digits) return null;
  let col = 0;
  for (const char of letters) col = col * 26 + (char.charCodeAt(0) - 64);
  return [Number(digits) - 1, col - 1];
}

function argbToCss(argb: string | null): string | undefined {
  if (!argb || !/^[0-9a-f]{8}$/i.test(argb)) return undefined;
  const rgb = argb.slice(2).toLowerCase();
  // Plain black is the default text colour; leave it to the theme.
  return rgb === "000000" ? undefined : `#${rgb}`;
}

function parseLooks(stylesXml: string): Array<CellLook | null> {
  const fonts: CellLook[] = [];
  const fontsBlock =
    /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml)?.[1] ?? "";
  for (const font of fontsBlock.match(
    /<font\b[^>]*>[\s\S]*?<\/font>|<font\b[^>]*\/>/g,
  ) ?? []) {
    const flag = (name: string) => {
      const tag = new RegExp(`<${name}\\b[^>]*?/?>`).exec(font)?.[0];
      if (!tag) return false;
      const value = attribute(tag, "val");
      return (
        value === null ||
        (value !== "0" && value !== "false" && value !== "none")
      );
    };
    const colorTag = /<color\b[^>]*\/?>/.exec(font)?.[0];
    fonts.push({
      bold: flag("b") || undefined,
      italic: flag("i") || undefined,
      underline: flag("u") || undefined,
      color: colorTag ? argbToCss(attribute(colorTag, "rgb")) : undefined,
    });
  }
  const looks: Array<CellLook | null> = [];
  const xfsBlock =
    /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  for (const xf of xfsBlock.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) ??
    []) {
    const open = /<xf\b[^>]*>/.exec(xf)?.[0] ?? xf;
    const font = fonts[Number(attribute(open, "fontId") ?? 0)] ?? {};
    const alignTag = /<alignment\b[^>]*\/?>/.exec(xf)?.[0];
    const horizontal = alignTag ? attribute(alignTag, "horizontal") : null;
    const look: CellLook = { ...font };
    if (
      horizontal === "left" ||
      horizontal === "center" ||
      horizontal === "right"
    ) {
      look.align = horizontal;
    } else if (horizontal === "centerContinuous") {
      look.align = "center";
    }
    const interesting =
      look.bold || look.italic || look.underline || look.align || look.color;
    looks.push(interesting ? look : null);
  }
  return looks;
}

function resolvePath(target: string): string {
  const clean = target.replace(/^\//, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean}`;
}

/**
 * The looks of styled cells in an XLSX workbook, up to `maxRows` rows per
 * sheet. Returns an empty map for anything it can't read.
 */
export async function readSheetLooks(
  bytes: Uint8Array,
  maxRows: number,
): Promise<SheetLooks> {
  const result: SheetLooks = new Map();
  try {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(bytes, {
      filter: (file) =>
        (file.name === "xl/styles.xml" ||
          file.name === "xl/workbook.xml" ||
          file.name === "xl/_rels/workbook.xml.rels" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(file.name)) &&
        file.originalSize <= MAX_SHEET_XML,
    });
    const styles = files["xl/styles.xml"];
    const workbook = files["xl/workbook.xml"];
    const rels = files["xl/_rels/workbook.xml.rels"];
    if (!styles || !workbook || !rels) return result;
    const looks = parseLooks(strFromU8(styles));
    if (!looks.some(Boolean)) return result;

    const targets = new Map<string, string>();
    for (const rel of strFromU8(rels).match(/<Relationship\b[^>]*>/g) ?? []) {
      const id = attribute(rel, "Id");
      const target = attribute(rel, "Target");
      if (id && target) targets.set(id, resolvePath(target));
    }
    for (const sheet of strFromU8(workbook).match(/<sheet\b[^>]*>/g) ?? []) {
      const name = attribute(sheet, "name");
      const id = attribute(sheet, "r:id");
      const path = id ? targets.get(id) : undefined;
      const xml = path ? files[path] : undefined;
      if (!name || !xml) continue;
      const cells = new Map<string, CellLook>();
      const text = strFromU8(xml);
      const pattern = /<c\b([^>]*?)\/?>/g;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match) {
        const attributes = match[1] ?? "";
        const styleIndex = attribute(attributes, "s");
        if (styleIndex) {
          const look = looks[Number(styleIndex)];
          const ref = look ? attribute(attributes, "r") : null;
          const position = ref ? decodeCellRef(ref) : null;
          if (position && position[0] >= maxRows) break;
          if (look && position)
            cells.set(`${position[0]},${position[1]}`, look);
        }
        match = pattern.exec(text);
      }
      // Entities in names were decoded by the parser that named the sheets.
      result.set(
        name
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'"),
        cells,
      );
    }
  } catch {
    // The default look.
  }
  return result;
}
