// A safety net for text an agent writes for people (comments, its run
// summary): internal ids mean nothing to a reader. An id that names
// something the run could read becomes what people know it by: a page its
// linked title, a task its key, a project or a member their name. Ids
// nobody resolved stay as they are, and code spans, code blocks, link
// targets, URLs and tags are never touched (ids there are load-bearing).
// Pure: the caller resolves the ids (known-entities.ts).

export type KnownEntity = {
  kind: "page" | "task" | "project" | "user";
  /** Page title, task key, project or member name. */
  label: string;
  /** App path, for pages: rendered as a Markdown link. */
  url?: string | null;
};

// cuid2 ids (24 lowercase letters and digits) and Better Auth ids (32 mixed
// case). Ids always mix letters and digits, which keeps plain words out.
const ID_SOURCE =
  "(?<![A-Za-z0-9_\\-./:=#@])[A-Za-z0-9]{16,40}(?![A-Za-z0-9_\\-])";
const MAX_CANDIDATES = 50;

function looksLikeId(token: string): boolean {
  return /[0-9]/.test(token) && /[A-Za-z]/.test(token);
}

// Pieces that are copied verbatim: fenced code, inline code, Markdown links
// and images (their text is scrubbed separately), autolinks, HTML and
// Margaya tags, URLs and app paths.
const PROTECTED = new RegExp(
  [
    "(?:^|(?<=\\n))[ \\t]*(```|~~~)[^\\n]*\\n[\\s\\S]*?(?:\\n[ \\t]*\\1[^\\n]*|$)",
    "``[^\\n]*?``",
    "`[^`\\n]*`",
    '!?\\[[^\\]\\n]*\\]\\([^)\\s]*(?:\\s+"[^"\\n]*")?\\)',
    "<https?:\\/\\/[^>\\s]+>",
    "<\\/?[A-Za-z][^>\\n]*>",
    "https?:\\/\\/[^\\s<>()]+",
    "(?<![\\w)\\]])\\/[A-Za-z0-9_\\-]+(?:\\/[A-Za-z0-9_\\-.]+)+",
  ].join("|"),
  "g",
);

const LINK = /^(!?)\[([^\]\n]*)\](\([\s\S]*\))$/;

type Segment = { text: string; protected: boolean };

function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    const start = match.index ?? 0;
    if (start > last)
      out.push({ text: text.slice(last, start), protected: false });
    out.push({ text: match[0], protected: true });
    last = start + match[0].length;
  }
  if (last < text.length)
    out.push({ text: text.slice(last), protected: false });
  return out;
}

/** Id-looking tokens outside code, links and URLs: what to resolve. */
export function idCandidates(text: string): string[] {
  const found = new Set<string>();
  for (const segment of segments(text)) {
    const scan = segment.protected
      ? LINK.exec(segment.text)?.[2] // a link's text, not its target
      : segment.text;
    if (!scan) continue;
    for (const match of scan.matchAll(new RegExp(ID_SOURCE, "g"))) {
      if (looksLikeId(match[0])) found.add(match[0]);
      if (found.size >= MAX_CANDIDATES) return [...found];
    }
  }
  return [...found];
}

function escapeLinkText(label: string): string {
  return label.replace(/[[\]\\]/g, (char) => `\\${char}`);
}

function render(entity: KnownEntity, asLink: boolean): string {
  const label = entity.label.trim() || "Untitled";
  if (entity.kind === "page" && asLink && entity.url) {
    return `[${escapeLinkText(label)}](${entity.url})`;
  }
  return entity.kind === "page" ? `"${label}"` : label;
}

const NOUN = "(?:page|task|issue|project|user|member|person|comment|run)";

function scrubPlain(
  text: string,
  known: ReadonlyMap<string, KnownEntity>,
  asLink: boolean,
): string {
  const lookup = (token: string) =>
    looksLikeId(token) ? known.get(token) : undefined;

  // "(task abc…, page id def…)": a task keeps its key ("(task WEB-7)");
  // other parts that only name a known id go, and so does the whole
  // parenthesis when nothing else is left.
  const onlyId = new RegExp(
    `^\\s*((?:the\\s+)?${NOUN}\\s+)?(?:(?:id|ID|Id)\\s*[:#=]?\\s*)?(${ID_SOURCE})\\s*$`,
  );
  let out = text.replace(/[ \t]?\(([^()\n]*)\)/g, (whole, inner: string) => {
    const parts = inner.split(/([,;])/);
    const kept: string[] = [];
    let changed = false;
    for (let index = 0; index < parts.length; index += 2) {
      const part = parts[index] ?? "";
      const match = onlyId.exec(part);
      const entity = match?.[2] ? lookup(match[2]) : undefined;
      if (entity?.kind === "task") {
        kept.push(`${match?.[1] ?? ""}${entity.label}`.trim());
        changed = true;
        continue;
      }
      if (entity) {
        changed = true;
        continue;
      }
      kept.push(part.trim());
    }
    if (!changed) return whole;
    const rest = kept.filter(Boolean);
    if (rest.length === 0) return "";
    const lead = whole.startsWith("(") ? "" : whole[0];
    return `${lead}(${rest.join(", ")})`;
  });

  // "page id abc…" → "page [Title](…)"; then any other bare known id.
  out = out.replace(
    new RegExp(`\\b(?:id|ID|Id)\\s*[:#=]?\\s*(${ID_SOURCE})`, "g"),
    (whole, id: string) => {
      const entity = lookup(id);
      return entity ? render(entity, asLink) : whole;
    },
  );
  return out.replace(new RegExp(ID_SOURCE, "g"), (token) => {
    const entity = lookup(token);
    return entity ? render(entity, asLink) : token;
  });
}

/**
 * Replaces known ids in text written for people. `known` maps an id to
 * the entity it names; anything else is left alone.
 */
export function scrubIds(
  text: string,
  known: ReadonlyMap<string, KnownEntity>,
): string {
  if (!text || known.size === 0) return text;
  return segments(text)
    .map((segment) => {
      if (!segment.protected) return scrubPlain(segment.text, known, true);
      // A link keeps its target; its text loses ids (no nested links).
      const link = LINK.exec(segment.text);
      if (!link) return segment.text;
      return `${link[1]}[${scrubPlain(link[2] ?? "", known, false)}]${link[3]}`;
    })
    .join("");
}
