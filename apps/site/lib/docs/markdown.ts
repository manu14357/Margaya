import { Marked, Renderer, type Tokens } from "marked";

// Renders the Mintlify-flavoured MDX in apps/docs to HTML at build time. Only
// the JSX components the docs use are supported; each becomes plain HTML with
// blank lines around it, so the markdown between the tags is still parsed.

export type DocHeading = { id: string; text: string; depth: number };

export type RenderOptions = {
  /** Turns an href written in the page into a URL on this site. */
  resolveHref?: (href: string) => string;
  /** Heading ids already used on the page, such as the operation sections. */
  reservedIds?: Iterable<string>;
};

const CALLOUTS: Record<string, string> = {
  Note: "Note",
  Info: "Info",
  Tip: "Tip",
  Warning: "Warning",
  Danger: "Warning",
  Check: "Success",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).trim();
}

/** GitHub-style heading slug: lower case, punctuation dropped, spaces to `-`. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-") || "section"
  );
}

function createSlugger(reserved: Iterable<string> = []) {
  const used = new Set(reserved);
  return (text: string) => {
    const base = slugify(text);
    let id = base;
    for (let count = 1; used.has(id); count += 1) id = `${base}-${count}`;
    used.add(id);
    return id;
  };
}

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href) && !href.startsWith("https://margaya.app");
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(
    /([a-zA-Z-]+)(?:=(?:"([^"]*)"|'([^']*)'|\{["'`]?([^}"'`]*)["'`]?\}))?/g,
  )) {
    const name = match[1];
    if (name) attributes[name] = match[2] ?? match[3] ?? match[4] ?? "true";
  }
  return attributes;
}

const COMPONENT_TAG =
  /<(\/?)([A-Z][A-Za-z]*)((?:\s+[a-zA-Z-]+(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*)\s*(\/?)>/g;

function componentHtml(
  name: string,
  closing: boolean,
  attributes: Record<string, string>,
  context: {
    slug: (text: string) => string;
    resolveHref: (href: string) => string;
  },
): string {
  const label = CALLOUTS[name];
  if (label) {
    return closing
      ? "</div>"
      : `<div class="docs-callout docs-callout-${name.toLowerCase()}" role="note" aria-label="${label}">`;
  }
  switch (name) {
    case "Steps":
      return closing ? "</ol>" : '<ol class="docs-steps">';
    case "Step": {
      if (closing) return "</li>";
      const title = attributes.title
        ? `<p class="docs-step-title" id="${context.slug(attributes.title)}">${escapeHtml(attributes.title)}</p>`
        : "";
      return `<li class="docs-step">${title}`;
    }
    case "Card": {
      if (closing) return "</div>";
      const title = escapeHtml(attributes.title ?? "");
      const heading = attributes.href
        ? `<a class="docs-card-link" href="${escapeHtml(context.resolveHref(attributes.href))}">${title}</a>`
        : title;
      return `<div class="docs-card"><p class="docs-card-title">${heading}</p>`;
    }
    case "CardGroup":
    case "Columns":
      return closing ? "</div>" : '<div class="docs-card-group">';
    case "AccordionGroup":
    case "Frame":
      return closing ? "</div>" : `<div class="docs-${name.toLowerCase()}">`;
    case "Accordion":
      return closing
        ? "</details>"
        : `<details class="docs-accordion"><summary>${escapeHtml(attributes.title ?? "Details")}</summary>`;
    default:
      // Unknown components keep their content and lose the wrapper.
      return "";
  }
}

/** Replaces JSX component tags outside fenced code with HTML blocks. */
function transformComponents(
  body: string,
  context: {
    slug: (text: string) => string;
    resolveHref: (href: string) => string;
  },
): string {
  const output: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;

  const flushProse = () => {
    if (prose.length === 0) return;
    output.push(
      prose
        .join("\n")
        .replace(
          COMPONENT_TAG,
          (
            _match,
            slash: string,
            name: string,
            attrs: string,
            self: string,
          ) => {
            const attributes = parseAttributes(attrs);
            const open = componentHtml(
              name,
              slash === "/",
              attributes,
              context,
            );
            const html =
              self === "/"
                ? `${open}\n\n${componentHtml(name, true, attributes, context)}`
                : open;
            return html ? `\n\n${html}\n\n` : "\n\n";
          },
        ),
    );
    prose = [];
  };

  for (const line of body.split("\n")) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (opener?.startsWith(fence) && line.trim() === opener) {
        output.push(line.trimStart());
        fence = null;
      } else {
        output.push(line);
      }
    } else if (opener) {
      flushProse();
      fence = opener;
      // Fences inside a component are often indented; the content is not code.
      output.push(line.trimStart());
    } else {
      prose.push(line);
    }
  }
  flushProse();
  return output.join("\n");
}

/**
 * Renders a docs page body and collects its h2/h3 outline in the same pass,
 * so the table of contents can never drift from the ids in the HTML.
 */
export function renderDocMarkdown(
  markdown: string,
  options: RenderOptions = {},
): { html: string; headings: DocHeading[] } {
  const headings: DocHeading[] = [];
  const slug = createSlugger(options.reservedIds);
  const resolveHref = options.resolveHref ?? ((href: string) => href);
  const instance = new Marked({ gfm: true, breaks: false });

  instance.use({
    renderer: {
      heading(token: Tokens.Heading) {
        const inline = this.parser.parseInline(token.tokens);
        const text = plainText(inline);
        const id = slug(text);
        if (token.depth === 2 || token.depth === 3) {
          headings.push({ id, text, depth: token.depth });
        }
        return `<h${token.depth} id="${id}">${inline}</h${token.depth}>\n`;
      },

      link(token: Tokens.Link) {
        const href = resolveHref(token.href);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        const inline = this.parser.parseInline(token.tokens);
        const target = isExternal(href)
          ? ' target="_blank" rel="noreferrer noopener"'
          : "";
        return `<a href="${escapeHtml(href)}"${title}${target}>${inline}</a>`;
      },

      image(token: Tokens.Image) {
        return `<img src="${escapeHtml(resolveHref(token.href))}" alt="${escapeHtml(token.text)}" loading="lazy" decoding="async" />`;
      },

      code(token: Tokens.Code) {
        const [language = "", ...rest] = (token.lang ?? "").trim().split(/\s+/);
        const title = rest.join(" ");
        const label = title || language;
        const header = label
          ? `<div class="docs-code-header"><span>${escapeHtml(label)}</span></div>`
          : "";
        const languageClass = language
          ? ` class="language-${escapeHtml(language)}"`
          : "";
        return `<div class="docs-code">${header}<pre><code${languageClass}>${escapeHtml(token.text)}</code></pre></div>\n`;
      },

      // Wide tables scroll inside the article rather than widening the page.
      table(token: Tokens.Table) {
        const html = Renderer.prototype.table.call(this, token);
        return `<div class="docs-table">${html}</div>\n`;
      },
    },
  });

  const source = transformComponents(markdown, { slug, resolveHref });
  const html = instance.parse(source, { async: false });
  return { html, headings };
}

const inlineMarked = new Marked({ gfm: true });

/** Inline markdown (code spans, emphasis, links) for short API descriptions. */
export function renderInlineMarkdown(markdown: string): string {
  // Descriptions come from API schemas: keep any angle brackets outside code
  // spans as text rather than letting them through as HTML.
  const safe = markdown
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 ? part : part.replace(/</g, "&lt;")))
    .join("");
  return inlineMarked.parseInline(safe, { async: false }) as string;
}
