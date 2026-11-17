import DOMPurify from "dompurify";

// Separate sanitiser instances, so the hooks one view adds never apply to
// another (hooks are per instance).

const SAFE_LINK = /^(https?:|mailto:)/i;

let markdownPurifier: ReturnType<typeof DOMPurify> | null = null;

/**
 * Markdown output made safe to insert: no scripts, styles, forms or
 * frames; links open outside with no opener; images only from https or
 * inline data.
 */
export function sanitizeMarkdownHtml(html: string): string {
  if (!markdownPurifier) {
    markdownPurifier = DOMPurify(window);
    markdownPurifier.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        const href = node.getAttribute("href") ?? "";
        if (SAFE_LINK.test(href)) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer nofollow");
        } else if (!href.startsWith("#")) {
          node.removeAttribute("href");
        }
      }
      if (node.tagName === "IMG") {
        const src = node.getAttribute("src") ?? "";
        if (!/^(https:|data:image\/(png|jpe?g|gif|webp|avif);)/i.test(src)) {
          node.removeAttribute("src");
        }
        node.setAttribute("referrerpolicy", "no-referrer");
        node.setAttribute("loading", "lazy");
      }
    });
  }
  return markdownPurifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "iframe",
      "video",
      "audio",
      "source",
    ],
    FORBID_ATTR: ["style", "id", "name"],
  });
}

/**
 * Event-handler attributes dropped from the markup text before it is
 * parsed. Parsing alone makes the browser report each one to the page's
 * content policy (blocked, but logged as an error), so the obvious ones go
 * first. Not a sanitiser: anything this misses, the sanitiser still removes.
 */
export function dropInlineHandlers(markup: string): string {
  return markup.replace(/<[a-zA-Z][^<>]*>/g, (tag) =>
    tag.replace(/\s+on[a-z0-9_-]*\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, ""),
  );
}

let documentPurifier: ReturnType<typeof DOMPurify> | null = null;

// Inside the frame nothing may load from outside: no tracking pixels, fonts
// or style sheets; inline styles and embedded images are fine.
const FRAME_POLICY =
  "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'";

/**
 * An uploaded HTML page as a self-contained document for a sandboxed
 * frame: no scripts, frames, forms, links or outside resources.
 */
export function sanitizeHtmlDocument(html: string): string {
  if (!documentPurifier) {
    documentPurifier = DOMPurify(window);
    documentPurifier.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("title", node.getAttribute("href") ?? "");
        node.removeAttribute("href");
      }
      for (const attribute of ["src", "srcset", "poster", "background"]) {
        const value = node.getAttribute(attribute);
        if (value !== null && !/^data:/i.test(value.trim())) {
          node.removeAttribute(attribute);
        }
      }
    });
  }
  const sanitized = documentPurifier.sanitize(dropInlineHandlers(html), {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "frame",
      "frameset",
      "object",
      "embed",
      "form",
      "base",
      "link",
      "meta",
    ],
  });
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><meta name="referrer" content="no-referrer">`;
  // The policy must come first, before any style the page brings.
  const withPolicy = /<head[^>]*>/i.test(sanitized)
    ? sanitized.replace(/<head[^>]*>/i, (tag) => `${tag}${head}`)
    : `<head>${head}</head>${sanitized}`;
  return `<!doctype html>${withPolicy}`;
}

let svgPurifier: ReturnType<typeof DOMPurify> | null = null;

/** An SVG with scripts, event handlers and foreign content removed. */
export function sanitizeSvg(svg: string): string {
  svgPurifier ??= DOMPurify(window);
  return svgPurifier.sanitize(dropInlineHandlers(svg), {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
