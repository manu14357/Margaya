import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isYouTubeUrl, normalizeUrl } from "@/lib/editor-url-utils";
import type { EditorRange } from "./use-editor-asset-upload";

type ComposerState = {
  mode: "choice" | "input";
  url: string;
  top: number;
  left: number;
  /** The pasted link, replaced by the embed. */
  linkRange?: EditorRange;
};

type Options = {
  editor: Editor | null;
  canEdit: () => boolean;
};

/**
 * The YouTube embed-or-link composer: after a YouTube URL is pasted it offers
 * "Embed video" (Tab or Enter) or "Keep as link" (Escape).
 */
export function useEmbedComposer({ editor, canEdit }: Options) {
  const { t } = useTranslation();
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [error, setError] = useState("");
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const close = useCallback(() => {
    setComposer(null);
    setError("");
  }, []);

  const offerEmbed = useCallback((state: Omit<ComposerState, "mode">) => {
    setComposer({ ...state, mode: "choice" });
    setError("");
  }, []);

  const submit = useCallback(
    (mode: "embed" | "link") => {
      const current = composerRef.current;
      if (!canEditRef.current() || !editor || !current) return;
      const url = normalizeUrl(current.url);
      if (!url) {
        setError(t("tasks:detail.editor.embed.errors.invalidUrl"));
        return;
      }
      if (current.mode === "choice" && mode === "link") {
        close();
        return;
      }
      if (mode === "embed" && !isYouTubeUrl(url)) {
        setError(t("tasks:detail.editor.embed.errors.onlyYoutube"));
        return;
      }
      const chain = editor.chain().focus();
      if (current.linkRange) chain.deleteRange(current.linkRange);
      if (mode === "link") {
        chain
          .insertContent({
            type: "text",
            text: url,
            marks: [{ type: "link", attrs: { href: url } }],
          })
          .run();
      } else {
        chain
          .insertContent({ type: "embedBlock", attrs: { url, mode: "embed" } })
          .run();
      }
      close();
    },
    [close, editor, t],
  );

  useEffect(() => {
    if (!composer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (
        composer.mode === "choice" &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        submit("embed");
      } else if (event.key === "Enter") {
        event.preventDefault();
        submit(composer.mode === "choice" ? "embed" : "link");
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, composer, submit]);

  const element =
    editor && composer ? (
      <div
        className="margaya-embed-composer"
        style={{ top: composer.top, left: composer.left, position: "absolute" }}
      >
        {composer.mode === "choice" ? (
          <div className="margaya-embed-choice-menu">
            <button
              type="button"
              className="margaya-embed-choice-item is-primary"
              onMouseDown={(event) => {
                event.preventDefault();
                submit("embed");
              }}
            >
              <span>{t("tasks:detail.editor.embed.choice.embedVideo")}</span>
              <span className="margaya-embed-choice-hint">Tab</span>
            </button>
            <button
              type="button"
              className="margaya-embed-choice-item"
              onMouseDown={(event) => {
                event.preventDefault();
                close();
              }}
            >
              <span>{t("tasks:detail.editor.embed.choice.keepAsLink")}</span>
              <span className="margaya-embed-choice-hint">Esc</span>
            </button>
          </div>
        ) : (
          <form
            className="margaya-embed-composer-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit("embed");
            }}
          >
            <Input
              size="sm"
              value={composer.url}
              onChange={(event) => {
                setComposer((current) =>
                  current ? { ...current, url: event.target.value } : current,
                );
                setError("");
              }}
              placeholder={t("tasks:detail.editor.embed.inputPlaceholder")}
              autoFocus
            />
            <div className="margaya-embed-composer-actions">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => submit("link")}
              >
                {t("tasks:detail.editor.embed.asLink")}
              </Button>
              <Button type="submit" size="xs">
                {t("tasks:detail.editor.embed.submit")}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={close}>
                {t("common:actions.cancel")}
              </Button>
            </div>
            {error && <p className="margaya-embed-composer-error">{error}</p>}
          </form>
        )}
      </div>
    ) : null;

  return { offerEmbed, close, element, isOpen: composer !== null };
}
