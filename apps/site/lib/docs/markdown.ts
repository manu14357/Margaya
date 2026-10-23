import { Marked, Renderer, type Tokens } from "marked";
import {
  type CodeTab,
  codeBlockHtml,
  codeTabsHtml,
  escapeHtml,
  parseCodeMeta,
  tabsHtml,
} from "./highlight";
import { type DocsIconName, docsIcon, docsIconName } from "./icons";
import { screenshotHtml } from "./screenshots";

export { escapeHtml } from "./highlight";

// Renders the Mintlify-flavoured MDX in apps/docs to HTML at build time. Only
// the JSX components the docs use are supported; each becomes plain HTML with
// blank lines around it, so the markdown between the tags is still parsed.

export type DocHeading = { id: string; text: string; depth: number };

export type RenderOptions = {
  /** Turns an href written in the page into a URL on this site. */
  resolveHref?: (href: string) => string;
  /** Heading ids already used on the page, such as the operation sections. */
  reservedIds?: Iterable<string>;
  /** Names the page in build warnings, e.g. `core/cycles`. */
  source?: string;
  /** False skips syntax highlighting, for callers that only need text and ids. */
  highlight?: boolean;
};

type CalloutKind = { label: string; icon: DocsIconName };

const CALLOUTS: Record<string, CalloutKind> = {
  Note: { label: "Note", icon: "info" },
  Info: { label: "Info", icon: "info" },
  Tip: { label: "Tip", icon: "lightbulb" },
  Check: { label: "Success", icon: "circle-check" },
  Warning: { label: "Warning", icon: "triangle-alert" },
  Danger: { label: "Danger", icon: "octagon-alert" },
};

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

// Inline code spans stay literal: `<API URL>` inside backticks is text.
const CODE_SPAN = /(``[^\n]*?``|`[^`\n]*`)/;

type RenderContext = {
  slug: (text: string) => string;
  resolveHref: (href: string) => string;
  source: string;
  plain: boolean;
  /** Renders nested MDX (a tab's body) with the same slugger and headings. */
  render: (body: string) => string;
};

// Components that sit inside a line of text rather than forming a block.
const INLINE_COMPONENTS = new Set(["Kbd", "Button"]);

const warned = new Set<string>();

function warnUnknown(source: string, name: string) {
  const key = `${source}:${name}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[docs] ${source}: unknown MDX component <${name}>. Its content is kept, but the component itself is not rendered. Add it to lib/docs/markdown.ts or remove it.`,
  );
}

function iconTile(name: string | undefined): string {
  const icon = name ? docsIconName(name) : null;
  return icon ? `<span class="docs-card-icon">${docsIcon(icon)}</span>` : "";
}

/** HTML for a component tag, or null when the component is unknown. */
function componentHtml(
  name: string,
  closing: boolean,
  attributes: Record<string, string>,
  context: RenderContext,
): string | null {
  const callout = CALLOUTS[name];
  if (callout) {
    if (closing) return "</div></div>";
    const title = escapeHtml(attributes.title ?? callout.label);
    return `<div class="docs-callout docs-callout-${name.toLowerCase()}" role="note" aria-label="${title}"><p class="docs-callout-title">${docsIcon(callout.icon)}<span>${title}</span></p><div class="docs-callout-body">`;
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
      if (closing) {
        const cta = attributes.cta
          ? `<p class="docs-card-cta"${attributes.href ? ' aria-hidden="true"' : ""}>${escapeHtml(attributes.cta)}<span aria-hidden="true"> →</span></p>`
          : "";
        return `</div>${cta}</div>`;
      }
      const title = escapeHtml(attributes.title ?? "");
      let heading = title;
      if (attributes.href) {
        const href = context.resolveHref(attributes.href);
        const external = isExternal(href)
          ? ' target="_blank" rel="noreferrer noopener"'
          : "";
        heading = `<a class="docs-card-link" href="${escapeHtml(href)}"${external}>${title}</a>`;
      }
      return `<div class="docs-card${attributes.href ? " docs-card-linked" : ""}">${iconTile(attributes.icon)}<p class="docs-card-title">${heading}</p><div class="docs-card-body">`;
    }
    case "CardGroup":
    case "Columns": {
      if (closing) return "</div>";
      const cols = Number(attributes.cols);
      const data = cols >= 1 && cols <= 4 ? ` data-cols="${cols}"` : "";
      return `<div class="docs-card-group"${data}>`;
    }
    case "AccordionGroup":
      return closing ? "</div>" : '<div class="docs-accordiongroup">';
    case "Accordion":
      return closing
        ? "</div></details>"
        : `<details class="docs-accordion"><summary>${docsIcon("chevron-right", "docs-icon docs-accordion-chevron")}<span>${escapeHtml(attributes.title ?? "Details")}</span></summary><div class="docs-accordion-body">`;
    case "Frame": {
      if (closing) {
        const caption = attributes.caption
          ? `<figcaption>${escapeHtml(attributes.caption)}</figcaption>`
          : "";
        return `${caption}</figure>`;
      }
      return '<figure class="docs-frame">';
    }
    case "Screenshot":
      return closing ? "" : screenshotHtml(attributes, context.source);
    case "Kbd":
      return closing ? "</kbd>" : "<kbd>";
    case "ButtonGroup":
      return closing ? "</div>" : '<div class="docs-button-group">';
    case "Button": {
      if (closing) return "</a>";
      const href = context.resolveHref(attributes.href ?? "#");
      const variant =
        attributes.primary === "true" ? "docs-button-primary" : "";
      return `<a class="docs-button ${variant}" href="${escapeHtml(href)}">`;
    }
    default:
      return null;
  }
}

/** Replaces component tags in a run of prose lines (no fenced code inside). */
function transformProse(
  text: string,
  stack: { name: string; attributes: Record<string, string> }[],
  context: RenderContext,
): string {
  return text
    .split(CODE_SPAN)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(
        COMPONENT_TAG,
        (_match, slash: string, name: string, attrs: string, self: string) => {
          const closing = slash === "/";
          let attributes = parseAttributes(attrs);
          if (closing) {
            const at = stack.map((entry) => entry.name).lastIndexOf(name);
            if (at !== -1)
              attributes = stack.splice(at, 1)[0]?.attributes ?? {};
          } else if (self !== "/") {
            stack.push({ name, attributes });
          }
          const open = componentHtml(name, closing, attributes, context);
          if (open === null) {
            if (!closing) warnUnknown(context.source, name);
            return INLINE_COMPONENTS.has(name) ? "" : "\n\n";
          }
          const html =
            self === "/"
              ? `${open}${INLINE_COMPONENTS.has(name) ? "" : "\n\n"}${componentHtml(name, true, attributes, context) ?? ""}`
              : open;
          return INLINE_COMPONENTS.has(name) ? html : `\n\n${html}\n\n`;
        },
      );
    })
    .join("");
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/** `<CodeGroup>`: the fences inside become one tabbed block. */
function codeGroupHtml(lines: string[], context: RenderContext): string {
  const tabs: CodeTab[] = [];
  let current: { fence: string; info: string; code: string[] } | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (current) {
      if (match?.[1]?.startsWith(current.fence) && !match[2]?.trim()) {
        const meta = parseCodeMeta(current.info);
        tabs.push({
          label: meta.title || meta.language || `Example ${tabs.length + 1}`,
          language: meta.language,
          code: current.code.join("\n"),
        });
        current = null;
      } else {
        current.code.push(line);
      }
    } else if (match?.[1]) {
      current = { fence: match[1], info: match[2] ?? "", code: [] };
    }
  }
  if (context.plain) {
    return tabs
      .map((tab) => codeBlockHtml(tab.code, tab.language, { plain: true }))
      .join("");
  }
  return codeTabsHtml(tabs);
}

/** `<Tabs>` with `<Tab title>` children: each body is rendered as MDX. */
function tabsGroupHtml(lines: string[], context: RenderContext): string {
  const panels: { label: string; html: string }[] = [];
  let current: { label: string; body: string[] } | null = null;
  let depth = 0;
  for (const line of lines) {
    const open = /^\s*<Tab(\s[^>]*)?>\s*$/.exec(line);
    const close = /^\s*<\/Tab>\s*$/.test(line);
    if (open && depth === 0) {
      const attributes = parseAttributes(open[1] ?? "");
      current = {
        label: attributes.title ?? `Tab ${panels.length + 1}`,
        body: [],
      };
      depth = 1;
    } else if (close && depth === 1 && current) {
      panels.push({
        label: current.label,
        html: context.render(current.body.join("\n")),
      });
      current = null;
      depth = 0;
    } else if (current) {
      if (open) depth += 1;
      if (close) depth -= 1;
      current.body.push(line);
    }
  }
  return tabsHtml(panels);
}

// Block components whose children are collected and rendered as one unit.
const GROUPS: Record<
  string,
  (lines: string[], context: RenderContext) => string
> = {
  CodeGroup: codeGroupHtml,
  Tabs: tabsGroupHtml,
};

/** Replaces JSX component tags outside fenced code with HTML blocks. */
function transformComponents(body: string, context: RenderContext): string {
  const output: string[] = [];
  const stack: { name: string; attributes: Record<string, string> }[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  let group: { name: string; depth: number; lines: string[] } | null = null;

  const flushProse = () => {
    if (prose.length === 0) return;
    output.push(transformProse(prose.join("\n"), stack, context));
    prose = [];
  };

  for (const line of body.split("\n")) {
    if (group) {
      const open = new RegExp(`^\\s*<${group.name}(\\s[^>]*)?>\\s*$`).test(
        line,
      );
      const close = new RegExp(`^\\s*</${group.name}>\\s*$`).test(line);
      if (open) group.depth += 1;
      if (close) group.depth -= 1;
      if (group.depth === 0) {
        const render = GROUPS[group.name];
        const html = render ? render(group.lines, context) : "";
        // An HTML block ends at a blank line, so the group must have none.
        output.push(`\n\n${html.replace(/\n\s*\n/g, "\n")}\n\n`);
        group = null;
      } else {
        group.lines.push(line);
      }
      continue;
    }
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
      const groupName = /^\s*<(CodeGroup|Tabs)(\s[^>]*)?>\s*$/.exec(line)?.[1];
      if (groupName) {
        flushProse();
        group = { name: groupName, depth: 1, lines: [] };
      } else {
        prose.push(line);
      }
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
  const plain = options.highlight === false;
  const instance = new Marked({ gfm: true, breaks: false });

  instance.use({
    // MDX has no indented code blocks: indentation inside a component
    // (`<Card>` bodies, nested steps) is layout, not code.
    tokenizer: {
      code() {
        return undefined;
      },
    },
    renderer: {
      heading(token: Tokens.Heading) {
        const inline = this.parser.parseInline(token.tokens);
        const text = plainText(inline);
        const id = slug(text);
        if (token.depth === 2 || token.depth === 3) {
          headings.push({ id, text, depth: token.depth });
        }
        const anchor =
          token.depth >= 2 && token.depth <= 4
            ? `<a class="docs-anchor" href="#${id}" aria-label="Link to this section">#</a>`
            : "";
        return `<h${token.depth} id="${id}">${inline}${anchor}</h${token.depth}>\n`;
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
        const meta = parseCodeMeta(token.lang ?? "");
        return `${codeBlockHtml(token.text, meta.language, {
          title: meta.title,
          lines: meta.lines,
          plain,
        })}\n`;
      },

      // Wide tables scroll inside the article rather than widening the page.
      table(token: Tokens.Table) {
        const html = Renderer.prototype.table.call(this, token);
        return `<div class="docs-table">${html}</div>\n`;
      },
    },
  });

  const context: RenderContext = {
    slug,
    resolveHref,
    source: options.source ?? "docs",
    plain,
    render: (body) =>
      instance.parse(transformComponents(body, context), {
        async: false,
      }) as string,
  };
  return { html: context.render(markdown), headings };
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
