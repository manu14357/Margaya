import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EDITOR_LINK_ERROR_KEYS,
  type EditorLinkError,
  normalizeEditorLinkUrl,
} from "@/lib/editor-link-url";

type LinkRequest = {
  editor: Editor;
  initialUrl: string;
  /** The selection is already a link, so it can be removed. */
  hasLink: boolean;
};

/** Sets the link on the selection (extended to the whole link), or removes it. */
export function applyEditorLink(editor: Editor, url: string | null) {
  const chain = editor.chain().extendMarkRange("link");
  if (url === null) chain.unsetLink().run();
  else chain.setLink({ href: url }).run();
}

/**
 * The link dialog of a rich-text editor. `openLinkDialog(editor)` asks for
 * an address for the selection, prefilled with the current link; render
 * `linkDialog` once next to the editor.
 */
export function useEditorLinkDialog() {
  const [request, setRequest] = useState<LinkRequest | null>(null);

  const openLinkDialog = useCallback(
    (editor: Editor, prefilledUrl?: string) => {
      if (!editor.isEditable) return;
      const current = editor.getAttributes("link").href as string | undefined;
      setRequest({
        editor,
        initialUrl: prefilledUrl || current || "",
        hasLink: Boolean(current),
      });
    },
    [],
  );

  const linkDialog = (
    <EditorLinkDialog request={request} onClose={() => setRequest(null)} />
  );

  return { openLinkDialog, linkDialog };
}

function EditorLinkDialog({
  request,
  onClose,
}: {
  request: LinkRequest | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const errorId = useId();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<EditorLinkError | null>(null);
  // Kept after close, so focus returns to the editor while the dialog fades.
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    if (!request) return;
    editorRef.current = request.editor;
    setUrl(request.initialUrl);
    setError(null);
  }, [request]);

  const finish = (href: string | null) => {
    if (request) applyEditorLink(request.editor, href);
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // React carries the submit up through the portal; an editor inside a
    // form (a comment composer) must not submit along with the link.
    event.stopPropagation();
    if (!request) return;
    if (!url.trim()) {
      // An empty address removes an existing link, as before.
      if (request.hasLink) finish(null);
      else setError("invalid");
      return;
    }
    const result = normalizeEditorLinkUrl(url);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finish(result.url);
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        finalFocus={() => {
          const editor = editorRef.current;
          return editor && !editor.isDestroyed ? editor.view.dom : true;
        }}
      >
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {request?.hasLink
                ? t("common:linkDialog.editTitle")
                : t("common:linkDialog.addTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("common:linkDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-6 pb-6">
            <Label htmlFor={inputId}>{t("common:linkDialog.urlLabel")}</Label>
            <Input
              id={inputId}
              autoFocus
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={2048}
              value={url}
              placeholder="https://"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
            />
            {error && (
              <p id={errorId} role="alert" className="text-destructive text-sm">
                {t(EDITOR_LINK_ERROR_KEYS[error])}
              </p>
            )}
          </div>
          <DialogFooter>
            {request?.hasLink && (
              <Button
                type="button"
                variant="destructive-outline"
                className="sm:me-auto"
                onClick={() => finish(null)}
              >
                {t("common:linkDialog.remove")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit">{t("common:linkDialog.apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
