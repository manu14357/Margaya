import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import diff from "shiki/langs/diff.mjs";
import docker from "shiki/langs/docker.mjs";
import dotenv from "shiki/langs/dotenv.mjs";
import ini from "shiki/langs/ini.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import nginx from "shiki/langs/nginx.mjs";
import python from "shiki/langs/python.mjs";
import sql from "shiki/langs/sql.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark-default.mjs";
import githubLight from "shiki/themes/github-light-default.mjs";
import { docsIcon } from "./icons";

// Build-time syntax highlighting for docs code blocks. Shiki runs only while
// the static pages render; the client receives plain HTML whose token colours
// are CSS variables (`--shiki-light` / `--shiki-dark`), switched by `.dark`.

const LIGHT = "github-light-default";
const DARK = "github-dark-default";

// Fence languages that are not a grammar name or alias in Shiki.
const LANGUAGE_ALIASES: Record<string, string> = {
  env: "dotenv",
  conf: "ini",
  cfg: "ini",
  console: "bash",
  curl: "bash",
};

let highlighter: HighlighterCore | null = null;

function getHighlighter(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    themes: [githubLight, githubDark],
    langs: [
      bash,
      diff,
      docker,
      dotenv,
      ini,
      javascript,
      json,
      markdown,
      nginx,
      python,
      sql,
      toml,
      tsx,
      typescript,
      yaml,
    ],
    // The JavaScript engine is synchronous and needs no WebAssembly.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The Shiki language for a fence language, or null for plain text. */
export function resolveLanguage(language: string): string | null {
  const name = language.trim().toLowerCase();
  if (!name) return null;
  const candidate = LANGUAGE_ALIASES[name] ?? name;
  const loaded = getHighlighter().getLoadedLanguages();
  return loaded.includes(candidate) ? candidate : null;
}

export type CodeMeta = {
  language: string;
  title: string;
  /** 1-based line numbers to highlight, from `{1,3-5}`. */
  lines: Set<number>;
};

/**
 * Parses a fence info string: `lang [title words] [title="…"] [{1,3-5}]`.
 * Mintlify writes a bare filename or tab label after the language.
 */
export function parseCodeMeta(info: string): CodeMeta {
  let rest = info.trim();
  const lines = new Set<number>();
  rest = rest.replace(/\{([\d,\s-]+)\}/g, (_match, ranges: string) => {
    for (const part of ranges.split(",")) {
      const [start, end] = part.split("-").map((value) => Number(value.trim()));
      if (!start) continue;
      for (let line = start; line <= (end || start); line += 1) lines.add(line);
    }
    return " ";
  });
  let title = "";
  rest = rest.replace(
    /\b(?:title|filename)=(?:"([^"]*)"|'([^']*)'|(\S+))/,
    (_match, double?: string, single?: string, bare?: string) => {
      title = double ?? single ?? bare ?? "";
      return " ";
    },
  );
  const [language = "", ...words] = rest.trim().split(/\s+/);
  if (!title) title = words.join(" ");
  return { language, title, lines };
}

/** Highlighted `<pre>` markup, or an escaped plain `<pre>` for unknown languages. */
export function highlightCode(
  code: string,
  language: string,
  lines: Set<number> = new Set(),
): string {
  const text = code.replace(/\n$/, "");
  const lang = resolveLanguage(language);
  if (!lang) {
    const body = text
      .split("\n")
      .map(
        (line, index) =>
          `<span class="line${lines.has(index + 1) ? " highlighted" : ""}">${escapeHtml(line)}</span>`,
      )
      .join("\n");
    return `<pre class="shiki" tabindex="0"><code>${body}</code></pre>`;
  }
  return getHighlighter().codeToHtml(text, {
    lang,
    themes: { light: LIGHT, dark: DARK },
    defaultColor: false,
    transformers: [
      {
        line(node, line) {
          if (lines.has(line)) this.addClassToHast(node, "highlighted");
        },
      },
    ],
  });
}

export function copyButtonHtml(label = "Copy code"): string {
  return `<button type="button" class="docs-copy" data-copy aria-label="${escapeHtml(label)}">${docsIcon("copy", "docs-icon docs-copy-idle")}${docsIcon("check", "docs-icon docs-copy-done")}</button>`;
}

export type CodeBlockOptions = {
  title?: string;
  lines?: Set<number>;
  /** Plain markup without Shiki, used where colours are never shown (search). */
  plain?: boolean;
};

/**
 * A code block: a title bar when the fence names a file or tab, otherwise a
 * language chip at the top right; always a copy button.
 */
export function codeBlockHtml(
  code: string,
  language: string,
  options: CodeBlockOptions = {},
): string {
  const title = options.title?.trim() ?? "";
  const pre = options.plain
    ? `<pre><code>${escapeHtml(code)}</code></pre>`
    : highlightCode(code, language, options.lines);
  const languageAttribute = language
    ? ` data-lang="${escapeHtml(language)}"`
    : "";
  const titleAttribute = title ? ` data-title="${escapeHtml(title)}"` : "";
  const head = title
    ? `<div class="docs-code-header"><span class="docs-code-title">${escapeHtml(title)}</span>${copyButtonHtml()}</div>`
    : `<div class="docs-code-actions">${language ? `<span class="docs-code-lang">${escapeHtml(language)}</span>` : ""}${copyButtonHtml()}</div>`;
  return `<div class="docs-code${title ? " docs-code-titled" : ""}"${languageAttribute}${titleAttribute}>${head}${pre}</div>`;
}

let tabsCounter = 0;

export type CodeTab = { label: string; language: string; code: string };

/**
 * Tabs around ready-made panels. Every panel is visible until the docs
 * script runs (`[data-docs-js]`), so the content never depends on JS.
 */
export function tabsHtml(
  panels: { label: string; html: string }[],
  options: { className?: string; header?: string } = {},
): string {
  tabsCounter += 1;
  const base = `docs-tabs-${tabsCounter}`;
  const tabs = panels
    .map(
      (panel, index) =>
        `<button type="button" role="tab" id="${base}-tab-${index}" aria-controls="${base}-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-tab-label="${escapeHtml(panel.label)}">${escapeHtml(panel.label)}</button>`,
    )
    .join("");
  const body = panels
    .map(
      (panel, index) =>
        `<div class="docs-tab-panel" role="tabpanel" id="${base}-panel-${index}" aria-labelledby="${base}-tab-${index}" data-tab-panel="${escapeHtml(panel.label)}"${index === 0 ? " data-active" : ""}>${panel.html}</div>`,
    )
    .join("");
  const header = options.header
    ? `<span class="docs-tabs-title">${escapeHtml(options.header)}</span>`
    : "";
  return `<div class="docs-tabs${options.className ? ` ${options.className}` : ""}" data-tabs><div class="docs-tabs-bar">${header}<div class="docs-tabs-list" role="tablist">${tabs}</div></div>${body}</div>`;
}

/** Code tabs (cURL / JavaScript / Python), as in `<CodeGroup>`. */
export function codeTabsHtml(
  tabs: CodeTab[],
  options: { header?: string } = {},
): string {
  return tabsHtml(
    tabs.map((tab) => ({
      label: tab.label,
      html: codeBlockHtml(tab.code, tab.language),
    })),
    { className: "docs-code-group", header: options.header },
  );
}
