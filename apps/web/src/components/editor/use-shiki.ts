import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Highlighter } from "shiki";
import { SHIKI_CODEBLOCK_REFRESH_META } from "@/components/task/extensions/shiki-code-block";

export const CODE_LANGUAGE_OPTIONS = [
  { value: "bash", label: "Bash" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "css", label: "CSS" },
  { value: "clojure", label: "Clojure" },
  { value: "cypher", label: "Cypher" },
  { value: "dart", label: "Dart" },
  { value: "diff", label: "Diff" },
  { value: "elixir", label: "Elixir" },
  { value: "excel", label: "Excel" },
  { value: "go", label: "Golang" },
  { value: "graphql", label: "GraphQL" },
  { value: "html", label: "HTML" },
  { value: "haskell", label: "Haskell" },
  { value: "json", label: "JSON" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "kotlin", label: "Kotlin" },
  { value: "makefile", label: "Makefile" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
  { value: "ocaml", label: "OCaml" },
  { value: "php", label: "PHP" },
  { value: "perl", label: "Perl" },
  { value: "plaintext", label: "Plaintext" },
  { value: "python", label: "Python" },
  { value: "r", label: "R" },
  { value: "reasonml", label: "ReasonML" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "toml", label: "TOML" },
  { value: "terraform", label: "Terraform" },
  { value: "typescript", label: "TypeScript" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
];

const SHIKI_LANGUAGE_ALIASES: Record<string, string> = {
  excel: "csv",
  plaintext: "text",
  reasonml: "ocaml",
};

/**
 * The shared Shiki highlighter for an editor. `toShikiLanguage` is stable:
 * it is an editor dependency, and a new one when Shiki finishes loading would
 * rebuild the editor mid-typing, so the loaded language list lives in a ref.
 * `supportedLanguages` (state) only feeds the language picker.
 */
export function useShiki() {
  const highlighterRef = useRef<Highlighter | null>(null);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const languagesRef = useRef(new Set<string>(["text"]));
  const [supportedLanguages, setSupportedLanguages] = useState(
    () => new Set<string>(["text"]),
  );

  useEffect(() => {
    let isDisposed = false;
    void Promise.all([
      import("@/lib/shiki-highlighter").then(({ getSharedShikiHighlighter }) =>
        getSharedShikiHighlighter(),
      ),
      import("shiki"),
    ])
      .then(([instance, { bundledLanguages }]) => {
        highlighterRef.current = instance;
        languagesRef.current = new Set([
          ...Object.keys(bundledLanguages),
          "text",
        ]);
        if (isDisposed) return;
        setHighlighter(instance);
        setSupportedLanguages(languagesRef.current);
      })
      .catch((error) => {
        console.error("Failed to initialize Shiki highlighter:", error);
      });
    return () => {
      isDisposed = true;
    };
  }, []);

  const toShikiLanguage = useCallback((language: string) => {
    const normalized = language.toLowerCase();
    return SHIKI_LANGUAGE_ALIASES[normalized] || normalized;
  }, []);

  const getHighlighter = useCallback(() => highlighterRef.current, []);

  return { highlighter, getHighlighter, toShikiLanguage, supportedLanguages };
}

/**
 * Re-highlights code blocks once Shiki is ready and whenever the app theme
 * (the `dark` class on <html>) changes.
 */
export function useShikiRefresh(
  editor: Editor | null,
  highlighter: Highlighter | null,
) {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !highlighter) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(SHIKI_CODEBLOCK_REFRESH_META, true),
    );
  }, [editor, highlighter]);

  useEffect(() => {
    if (!editor || typeof document === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (editor.isDestroyed) return;
      if (mutations.some((mutation) => mutation.attributeName === "class")) {
        editor.view.dispatch(
          editor.state.tr.setMeta(SHIKI_CODEBLOCK_REFRESH_META, true),
        );
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [editor]);
}
