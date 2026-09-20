// Reads a page editor's document for the side panel: the outline (H1-H3)
// and the text of each text block (for the statistics).

type DocNode = {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
  isTextblock: boolean;
  descendants: (
    callback: (node: DocNode, pos: number) => boolean | undefined,
  ) => void;
};

export type OutlineHeading = { level: 1 | 2 | 3; text: string; pos: number };

export function outlineFromDoc(doc: DocNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level);
      const text = node.textContent.trim();
      if ((level === 1 || level === 2 || level === 3) && text) {
        headings.push({ level, text, pos });
      }
      return false;
    }
    return undefined;
  });
  return headings;
}

export function textBlocksFromDoc(doc: DocNode): string[] {
  const blocks: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) {
      blocks.push(node.textContent);
      return false;
    }
    return undefined;
  });
  return blocks;
}
