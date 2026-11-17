import "@margaya/file-preview/styles.css";
import "./file-preview.css";
import { FilePreview, type PreviewSource } from "@margaya/file-preview";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Link2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { externalHref, isDesktopApp, openInSystemBrowser } from "@/lib/desktop";
import {
  fileDownloadUrl,
  isServerFileUrl,
  type PreviewFile,
  previewKind,
} from "@/lib/file-preview";
import { formatBytes } from "@/lib/format-bytes";
import { toast } from "@/lib/toast";
import { useFilePreviewLabels } from "./use-file-preview-labels";
import { useResolvedTheme } from "./use-resolved-theme";

export type FilePreviewState = { files: PreviewFile[]; index: number };

/**
 * One file at a time, full size, with the files around it a keypress away.
 * The body is the shared file preview: PDFs, Office files, spreadsheets,
 * slides, pictures, code, archives, 3D models, audio and video, each drawn
 * in the page from the file's bytes. Uploaded pages and SVGs are sanitised
 * and never run.
 */
export function FilePreviewDialog({
  state,
  onClose,
}: {
  state: FilePreviewState | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(state?.index ?? 0);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state) setIndex(state.index);
  }
  const files = state?.files ?? [];
  const file = files[Math.min(index, files.length - 1)];

  return (
    <Dialog
      open={Boolean(state && file)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {file ? (
        <FilePreviewPopup
          file={file}
          index={index}
          total={files.length}
          onStep={(step) =>
            setIndex((current) =>
              Math.min(Math.max(current + step, 0), files.length - 1),
            )
          }
        />
      ) : null}
    </Dialog>
  );
}

/** Opens the preview from anywhere in a component; render `dialog` once. */
export function useFilePreview() {
  const [state, setState] = useState<FilePreviewState | null>(null);
  const open = useCallback((files: PreviewFile[], index = 0) => {
    if (files.length === 0) return;
    setState({ files, index: Math.min(Math.max(index, 0), files.length - 1) });
  }, []);
  return {
    open,
    isOpen: state !== null,
    dialog: <FilePreviewDialog state={state} onClose={() => setState(null)} />,
  };
}

// Arrow keys belong to whatever has focus inside the preview (a scrolled
// document, a sheet, slides, a find box); elsewhere they step files.
function ignoresArrows(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, textarea, select, audio, video, [contenteditable], .mfp-scroll, [role='tab']",
    ) !== null
  );
}

/** Starts a download the same way the header's Download link does. */
function downloadFile(file: PreviewFile) {
  const link = document.createElement("a");
  link.href = fileDownloadUrl(file.url);
  link.download = file.name;
  if (externalHref(file.url)) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * What the preview may read. A file of this server is fetched with the
 * session; pictures, audio and video elsewhere play from their address like
 * any embedded media, and other files elsewhere are never fetched (the
 * card offers the links instead).
 */
export function previewSourceOf(file: PreviewFile): PreviewSource {
  const onServer = isServerFileUrl(file.url);
  const direct =
    file.kind === "image" ||
    ["image", "audio", "video"].includes(previewKind(file));
  return {
    name: file.name,
    // An editor image may have no type and no extension.
    mimeType: file.mimeType || (file.kind === "image" ? "image/*" : undefined),
    size: file.size,
    url: onServer || direct ? file.url : undefined,
    credentials: onServer ? "include" : "omit",
  };
}

function FilePreviewPopup({
  file,
  index,
  total,
  onStep,
}: {
  file: PreviewFile;
  index: number;
  total: number;
  onStep: (step: number) => void;
}) {
  const { t } = useTranslation();
  const popupRef = useRef<HTMLDivElement>(null);
  const firstIndexRef = useRef(index);
  // Stepping can disable the focused arrow (first or last file): keep the
  // keyboard in the dialog.
  useEffect(() => {
    const popup = popupRef.current;
    const active = document.activeElement;
    // Opening is the dialog's own focus management.
    if (!popup || index === firstIndexRef.current) return;
    firstIndexRef.current = -1;
    if (
      !active ||
      !popup.contains(active) ||
      (active instanceof HTMLButtonElement && active.disabled)
    ) {
      popup.focus({ preventScroll: true });
    }
  }, [index]);

  const kind = previewKind(file);
  const desktop = isDesktopApp();
  // Outside this server, a link works anywhere. A file of this server needs
  // the session: a browser tab has it, the system browser may not.
  const outside = externalHref(file.url);
  const theme = useResolvedTheme();
  const source = useMemo(() => previewSourceOf(file), [file]);
  const openExternal = useMemo(() => {
    if (desktop) {
      return outside ? () => openInSystemBrowser(outside) : undefined;
    }
    if (kind === "none" && !outside) return undefined;
    return () => {
      window.open(file.url, "_blank", "noopener,noreferrer");
    };
  }, [desktop, outside, kind, file.url]);
  const labels = useFilePreviewLabels(
    desktop
      ? t("common:filePreview.openInBrowser")
      : t("common:filePreview.openInNewTab"),
  );
  const onDownload = useCallback(() => downloadFile(file), [file]);

  const meta = [
    file.size ? formatBytes(file.size) : null,
    total > 1
      ? t("common:filePreview.position", { current: index + 1, total })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(file.url);
      toast.success(t("common:filePreview.linkCopied"));
    } catch {
      toast.error(t("common:filePreview.copyFailed"));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey) return;
    if (event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (total < 2 || ignoresArrows(event.target)) return;
      event.preventDefault();
      onStep(event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <DialogPopup
      ref={popupRef}
      className="h-[min(92svh,64rem)] max-w-6xl overflow-hidden outline-none"
      showCloseButton={false}
      bottomStickOnMobile={false}
      onKeyDown={onKeyDown}
      data-testid="file-preview"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DialogTitle
            className="truncate text-base leading-tight"
            title={file.name}
          >
            {file.name}
          </DialogTitle>
          <DialogDescription className="truncate text-xs">
            {meta || t("common:filePreview.description")}
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {total > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:filePreview.previous")}
                title={t("common:filePreview.previous")}
                disabled={index === 0}
                onClick={() => onStep(-1)}
              >
                <ChevronLeft className="rtl:-scale-x-100" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:filePreview.next")}
                title={t("common:filePreview.next")}
                disabled={index === total - 1}
                onClick={() => onStep(1)}
              >
                <ChevronRight className="rtl:-scale-x-100" />
              </Button>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            </>
          )}
          {desktop
            ? outside && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common:filePreview.openInBrowser")}
                  title={t("common:filePreview.openInBrowser")}
                  onClick={() => openInSystemBrowser(outside)}
                >
                  <ExternalLink />
                </Button>
              )
            : (kind !== "none" || outside) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common:filePreview.openInNewTab")}
                  title={t("common:filePreview.openInNewTab")}
                  render={
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLink />
                </Button>
              )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common:filePreview.download")}
            title={t("common:filePreview.download")}
            render={
              // A file of this server downloads in place (an attachment
              // response, with the session), which the desktop app turns
              // into its own download; a link elsewhere opens beside it.
              <a
                href={fileDownloadUrl(file.url)}
                download={file.name}
                {...(outside
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              />
            }
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common:filePreview.copyLink")}
            title={t("common:filePreview.copyLink")}
            onClick={() => void copyLink()}
          >
            <Link2 />
          </Button>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:actions.close")}
                title={t("common:actions.close")}
              />
            }
          >
            <X />
          </DialogClose>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <FilePreview
          key={`${index}:${file.url}`}
          source={source}
          labels={labels}
          theme={theme}
          onDownload={onDownload}
          onOpenExternal={openExternal}
          className="margaya-file-preview"
        />
      </div>
    </DialogPopup>
  );
}
