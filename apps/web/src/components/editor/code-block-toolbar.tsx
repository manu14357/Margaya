import type { Editor } from "@tiptap/core";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { isInCodeBlockLanguagePicker } from "@/lib/is-in-codeblock-language-picker";
import { CODE_LANGUAGE_OPTIONS } from "./use-shiki";

type HoveredCodeBlock = {
  language: string;
  nodePos: number;
  top: number;
  left: number;
};

type Options = {
  editor: Editor | null;
  shellRef: RefObject<HTMLElement | null>;
  canEdit: boolean;
  supportedLanguages: ReadonlySet<string>;
  toShikiLanguage: (language: string) => string;
};

/**
 * The language picker and copy button over the hovered code block. Returns
 * the mouse handlers for the editor content and the toolbar to render.
 */
export function useCodeBlockToolbar({
  editor,
  shellRef,
  canEdit,
  supportedLanguages,
  toShikiLanguage,
}: Options) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<HoveredCodeBlock | null>(null);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  const languages = useMemo(
    () =>
      CODE_LANGUAGE_OPTIONS.filter(({ value }) =>
        supportedLanguages.has(toShikiLanguage(value)),
      ).map(({ value, label }) => ({
        value,
        label: t(`tasks:detail.editor.languages.${value}`, {
          defaultValue: label,
        }),
      })),
    [supportedLanguages, t, toShikiLanguage],
  );

  const update = useCallback(
    (element: HTMLElement | null) => {
      if (!editor || editor.isDestroyed || !element) {
        if (!isMenuOpen) {
          hoveredElementRef.current = null;
          setHovered(null);
        }
        return;
      }
      const resolved = editor.state.doc.resolve(
        Math.max(
          0,
          Math.min(
            editor.view.posAtDOM(element, 0),
            editor.state.doc.content.size,
          ),
        ),
      );
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        const node = resolved.node(depth);
        if (node.type.name !== "codeBlock") continue;
        const rect = element.getBoundingClientRect();
        const shellRect = shellRef.current?.getBoundingClientRect();
        const nodePos = resolved.before(depth);
        hoveredElementRef.current = element;
        setHovered((current) => {
          if (current?.nodePos !== nodePos) setIsCopied(false);
          return {
            language: (node.attrs.language as string | undefined) || "auto",
            nodePos,
            top: shellRect ? rect.top - shellRect.top + 8 : rect.top + 8,
            left: shellRect
              ? rect.right - shellRect.left - 10
              : rect.right - 10,
          };
        });
        return;
      }
    },
    [editor, isMenuOpen, shellRef],
  );

  useEffect(() => {
    if (!hovered || !hoveredElementRef.current) return;
    const sync = () => update(hoveredElementRef.current);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [hovered, update]);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    [],
  );

  const onMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest(".margaya-codeblock-language")) return;
      update(target.closest("pre.margaya-tiptap-codeblock") as HTMLElement);
    },
    [update],
  );

  const onMouseLeave = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (isInCodeBlockLanguagePicker(event.relatedTarget)) return;
      if (isMenuOpen) return;
      hoveredElementRef.current = null;
      setHovered(null);
    },
    [isMenuOpen],
  );

  const setLanguage = (language: string | null) => {
    if (!canEdit || !editor || !hovered) return;
    const next = language || "auto";
    editor
      .chain()
      .focus()
      .setNodeSelection(hovered.nodePos)
      .updateAttributes("codeBlock", { language: next === "auto" ? "" : next })
      .run();
    setHovered((current) => (current ? { ...current, language: next } : null));
  };

  const copy = async () => {
    if (!editor || !hovered) return;
    const node = editor.state.doc.nodeAt(hovered.nodePos);
    const content = node?.type.name === "codeBlock" ? node.textContent : "";
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setIsCopied(false);
        copyResetRef.current = null;
      }, 1400);
    } catch {
      // Clipboard writes can be refused; nothing to undo.
    }
  };

  const activeLabel =
    languages.find((language) => language.value === hovered?.language)?.label ||
    t("tasks:detail.editor.autoDetect");

  const toolbar =
    editor && hovered ? (
      <div
        className="margaya-codeblock-language"
        style={{ top: hovered.top, left: hovered.left, position: "absolute" }}
      >
        <button
          type="button"
          className="margaya-codeblock-language-trigger margaya-codeblock-copy-trigger"
          aria-label={
            isCopied
              ? t("tasks:detail.editor.copied")
              : t("tasks:detail.editor.copyCode")
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copy()}
        >
          {isCopied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span>
            {isCopied
              ? t("tasks:detail.editor.copied")
              : t("tasks:detail.editor.copy")}
          </span>
        </button>
        {canEdit && (
          <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="margaya-codeblock-language-trigger"
              >
                <span className="truncate">{activeLabel}</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              sideOffset={6}
              className="max-h-72 w-48 overflow-y-auto"
            >
              <DropdownMenuRadioGroup
                value={hovered.language}
                onValueChange={setLanguage}
              >
                <DropdownMenuRadioItem value="auto">
                  {t("tasks:detail.editor.autoDetect")}
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {languages.map(({ value, label }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    ) : null;

  return { onMouseMove, onMouseLeave, toolbar };
}
