// Jira wiki markup → the Markdown task descriptions and comments store.
// Covers what Jira's editor writes: headings, text effects, monospace, code
// and noformat blocks, quotes, links, nested lists, tables and images (which
// become a text placeholder: files are not downloaded). Unknown macros keep
// their text.

// A private-use character marks placeholders: Jira text never holds one.
const TOKEN = "\uE000";
const TOKEN_PATTERN = /\uE000(\d+)\uE000/g;

class Tokens {
  private readonly values: string[] = [];

  add(value: string) {
    this.values.push(value);
    return `${TOKEN}${this.values.length - 1}${TOKEN}`;
  }

  restore(text: string): string {
    let result = text;
    // Tokens can nest (a link label holding monospace): restore until stable.
    for (let pass = 0; pass < 5 && result.includes(TOKEN); pass++) {
      result = result.replace(
        TOKEN_PATTERN,
        (_, index: string) => this.values[Number(index)] ?? "",
      );
    }
    return result;
  }
}

function fence(content: string, language: string) {
  const longest = Math.max(
    2,
    ...[...content.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const marker = "`".repeat(longest + 1);
  return `${marker}${language}\n${content.replace(/^\n+|\n+$/g, "")}\n${marker}`;
}

/** `{code:java|title=X}` → java; title-only or empty params → no language. */
function codeLanguage(params: string | undefined) {
  if (!params) return "";
  const first = params.split("|")[0]?.trim() ?? "";
  if (first.includes("=")) {
    const named = /(?:^|\|)\s*language\s*=\s*([\w+#-]+)/i.exec(params);
    return named?.[1]?.toLowerCase() ?? "";
  }
  return /^[\w+#-]+$/.test(first) ? first.toLowerCase() : "";
}

function inlineCode(content: string) {
  const ticks = content.includes("`") ? "``" : "`";
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${ticks}${pad}${content}${pad}${ticks}`;
}

const BOUNDARY_BEFORE = "(^|[\\s([{>\"'.,:;!?/]|\\uE000)";
const BOUNDARY_AFTER = "(?=$|[\\s)\\]}<\"'.,:;!?/]|\\uE000)";

/** Replaces a symmetric Jira text effect (`*bold*`) with Markdown. */
function convertEffect(
  text: string,
  marker: string,
  open: string,
  close = open,
): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${BOUNDARY_BEFORE}${escaped}(?=\\S)(.+?)(?<=\\S)${escaped}${BOUNDARY_AFTER}`,
    "gu",
  );
  return text.replace(
    pattern,
    (_, before: string, content: string) =>
      `${before}${open}${content}${close}`,
  );
}

function linkTarget(target: string) {
  const value = target.trim();
  if (/^(https?|ftp|mailto):/i.test(value)) return value;
  return null;
}

function escapeLinkLabel(label: string) {
  return label.replace(/([[\]])/g, "\\$1");
}

/** Text effects, links, monospace and images of one line. */
function convertInline(line: string, tokens: Tokens): string {
  let text = line;

  // Monospace first: its content is literal.
  text = text.replace(/\{\{(.+?)\}\}/g, (_, content: string) =>
    tokens.add(inlineCode(content)),
  );
  // Colour and similar wrapper macros keep only their text.
  text = text.replace(/\{(?:color|anchor|span)(?::[^}]*)?\}/gi, "");
  // Images and embedded attachments: a placeholder with the file name.
  text = text.replace(/!([^!\s][^!\n]*?)!/g, (whole, body: string) => {
    const source = body.split("|")[0]?.trim() ?? "";
    if (!/\.\w{2,5}$|^https?:/i.test(source)) return whole;
    const name = source.split("/").pop() || source;
    return tokens.add(`\\[image: ${name}\\]`);
  });
  // Links: [text|url], [url], [~user], [^attachment], [#anchor].
  text = text.replace(/\[([^\]\n]+)\]/g, (whole, body: string) => {
    const parts = body.split("|");
    if (parts.length >= 2) {
      const label = parts[0] ?? "";
      const target = linkTarget(parts[1] ?? "");
      if (!target) return tokens.add(escapeLinkLabel(label));
      return tokens.add(`[${escapeLinkLabel(label.trim())}](${target})`);
    }
    const single = body.trim();
    if (single.startsWith("~")) return tokens.add(`@${single.slice(1)}`);
    if (single.startsWith("^")) return tokens.add(single.slice(1));
    if (single.startsWith("#")) return tokens.add(single.slice(1));
    const target = linkTarget(single);
    if (target) return tokens.add(`<${target}>`);
    return whole;
  });
  // Bare URLs keep their dashes and underscores.
  text = text.replace(/\b(?:https?|ftp):\/\/[^\s<>"'\uE000]+/gi, (url) =>
    tokens.add(url),
  );

  // Order matters: each step's output must not match a later step's marker.
  // Superscript and subscript have no Markdown form: keep the text.
  text = convertEffect(text, "^", "");
  text = convertEffect(text, "~", "");
  text = convertEffect(text, "*", "**");
  text = convertEffect(text, "_", "*");
  text = convertEffect(text, "??", "*");
  text = convertEffect(text, "-", "~~");
  text = convertEffect(text, "+", "++");
  // A forced line break.
  text = text.replace(/\\\\/g, "\n");
  return text;
}

type ListFrame = { ordered: boolean; indent: number; width: number };

function splitTableRow(line: string): { header: boolean; cells: string[] } {
  const trimmed = line.trim();
  const header = trimmed.startsWith("||");
  const cells: string[] = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char === "[" || char === "{") depth += 1;
    if ((char === "]" || char === "}") && depth > 0) depth -= 1;
    if (char === "|" && depth === 0) {
      cells.push(current);
      current = "";
      if (trimmed[index + 1] === "|") index += 1;
      continue;
    }
    current += char;
  }
  cells.push(current);
  // The leading and trailing separators leave empty edge cells.
  if (cells[0]?.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === "") cells.pop();
  return { header, cells };
}

function tableToMarkdown(lines: string[], tokens: Tokens): string[] {
  const rows = lines.map(splitTableRow);
  const width = Math.max(1, ...rows.map((row) => row.cells.length));
  const render = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) =>
      convertInline((cells[index] ?? "").trim(), tokens)
        .replace(/\n/g, " ")
        .replace(/\|/g, "\\|"),
    ).join(" | ")} |`;
  const [first, ...rest] = rows;
  const header = first?.header ? first : { header: true, cells: [] };
  const body = first?.header ? rest : rows;
  return [
    render(header.cells),
    `|${" --- |".repeat(width)}`,
    ...body.map((row) => render(row.cells)),
  ];
}

/** Converts block structure line by line; `tokens` holds finished blocks. */
function convertBlocks(source: string, tokens: Tokens): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let lists: ListFrame[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (/^\|/.test(trimmed)) {
      const table: string[] = [];
      while (index < lines.length && /^\|/.test((lines[index] ?? "").trim())) {
        table.push(lines[index] ?? "");
        index += 1;
      }
      lists = [];
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(...tableToMarkdown(table, tokens), "");
      continue;
    }
    index += 1;

    const heading = /^h([1-6])\.\s*(.*)$/.exec(trimmed);
    if (heading) {
      lists = [];
      // Task descriptions have three heading levels.
      const level = Math.min(3, Number(heading[1]));
      out.push(
        `${"#".repeat(level)} ${convertInline(heading[2] ?? "", tokens)}`,
      );
      continue;
    }

    const quote = /^bq\.\s*(.*)$/.exec(trimmed);
    if (quote) {
      lists = [];
      out.push(`> ${convertInline(quote[1] ?? "", tokens)}`);
      continue;
    }

    if (/^-{4,}$/.test(trimmed)) {
      lists = [];
      out.push("", "---", "");
      continue;
    }

    const item = /^([*#-]+)\s+(.*)$/.exec(trimmed);
    if (item && (item[1] === "-" || !item[1]?.includes("-"))) {
      const markers = item[1] ?? "";
      const depth = markers.length;
      const ordered = markers.endsWith("#");
      lists = lists.slice(0, depth - 1);
      while (lists.length < depth - 1) {
        // A skipped level: indent as an unordered parent.
        const parent = lists[lists.length - 1];
        lists.push({
          ordered: false,
          indent: parent ? parent.indent + parent.width : 0,
          width: 2,
        });
      }
      const parent = lists[lists.length - 1];
      const indent = parent ? parent.indent + parent.width : 0;
      const bullet = ordered ? "1. " : "- ";
      lists.push({ ordered, indent, width: bullet.length });
      out.push(
        `${" ".repeat(indent)}${bullet}${convertInline(item[2] ?? "", tokens)}`,
      );
      continue;
    }

    if (trimmed === "") {
      lists = [];
      out.push("");
      continue;
    }

    if (/^\uE000\d+\uE000$/.test(trimmed)) {
      lists = [];
      out.push("", trimmed, "");
      continue;
    }

    lists = [];
    out.push(convertInline(line.trimEnd(), tokens));
  }

  return out.join("\n");
}

/**
 * Converts Jira wiki markup to Markdown. Code, noformat and quote blocks are
 * cut out first (their content is literal or converted on its own), then
 * the remaining lines are converted one by one.
 */
export function jiraWikiToMarkdown(input: string): string {
  if (!input) return "";
  const tokens = new Tokens();
  let text = input.replace(/\r\n?/g, "\n");

  text = text.replace(
    /\{code(?::([^}]*))?\}([\s\S]*?)\{code\}/gi,
    (_, params: string | undefined, content: string) =>
      `\n${tokens.add(fence(content, codeLanguage(params)))}\n`,
  );
  text = text.replace(
    /\{noformat(?::[^}]*)?\}([\s\S]*?)\{noformat\}/gi,
    (_, content: string) => `\n${tokens.add(fence(content, ""))}\n`,
  );
  text = text.replace(
    /\{quote\}([\s\S]*?)\{quote\}/gi,
    (_, content: string) => {
      const inner = tokens.restore(convertBlocks(content.trim(), tokens));
      const quoted = inner
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
      return `\n${tokens.add(quoted)}\n`;
    },
  );
  // Panels keep their content; a titled panel's title becomes bold.
  text = text.replace(/\{panel(?::([^}]*))?\}/gi, (_, params?: string) => {
    const title = params ? /title=([^|]+)/i.exec(params)?.[1]?.trim() : "";
    return title ? `\n*${title}*\n` : "\n";
  });

  const markdown = tokens.restore(convertBlocks(text, tokens));
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}
