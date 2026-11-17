import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki";
import type { LineToken } from "../components/line-view";

// One highlighter for every code view, with the same themes as the editor's
// code blocks. Languages load on first use; the JavaScript regex engine
// avoids WebAssembly, which some managed browsers disable.

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

const THEMES = { light: "github-light", dark: "github-dark" } as const;

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const pending: Promise<Highlighter> = Promise.all([
      import("shiki"),
      import("shiki/engine/javascript"),
    ])
      .then(([{ createHighlighter }, { createJavaScriptRegexEngine }]) =>
        createHighlighter({
          themes: [THEMES.light, THEMES.dark],
          langs: [],
          engine: createJavaScriptRegexEngine({ forgiving: true }),
        }),
      )
      .catch((error: unknown) => {
        highlighterPromise = null;
        throw error;
      });
    highlighterPromise = pending;
    return pending;
  }
  return highlighterPromise;
}

/**
 * Tokens per line of `code` (already split on newlines and joined with
 * "\n"), or null when the language can't be loaded.
 */
export async function highlightLines(
  code: string,
  language: string,
  theme: "light" | "dark",
): Promise<LineToken[][] | null> {
  const highlighter = await getHighlighter();
  try {
    if (!highlighter.getLoadedLanguages().includes(language)) {
      await highlighter.loadLanguage(language as never);
    }
  } catch {
    return null;
  }
  const result = highlighter.codeToTokens(code, {
    lang: language as never,
    theme: THEMES[theme],
  });
  return result.tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      color: token.color,
      fontStyle: token.fontStyle,
    })),
  );
}
