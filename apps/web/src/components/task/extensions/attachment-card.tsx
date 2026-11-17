import { FileTypeIcon, fileTypeLabel } from "@margaya/file-preview";
import { mergeAttributes, Node } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Download } from "lucide-react";
import type { MouseEvent, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFilePreview } from "@/components/file-preview/file-preview-dialog";
import { isDesktopApp } from "@/lib/desktop";
import { fileDownloadLinkProps } from "@/lib/file-download";
import { collectEditorFiles, resolveFileUrl } from "@/lib/file-preview";
import { formatBytes } from "@/lib/format-bytes";
import { escapeHtml } from "./url-safety";

/** Ctrl/Cmd/Shift-click or a middle click: the browser's own new tab. */
function wantsNewTab(event: MouseEvent) {
  return event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey;
}

/** Keeps a click on the download link from reaching editor wrappers. */
function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}

function AttachmentCardView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const preview = useFilePreview();
  // Absolute http(s) links and this server's own paths; javascript:, data:
  // and the like never become a link.
  const url = resolveFileUrl(String(node.attrs.url || ""));
  const filename = String(node.attrs.filename || "Attachment");
  const mimeType = String(node.attrs.mimeType || "");
  const size = Number(node.attrs.size || 0);
  const downloadLink = url ? fileDownloadLinkProps(url, filename) : null;
  const meta = [fileTypeLabel({ name: filename, mimeType }), formatBytes(size)]
    .filter(Boolean)
    .join(" · ");

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!url) return;
    // In a browser, the new-tab gestures keep their meaning. The desktop
    // app has no tabs: a file link there would open a bare window, so
    // every gesture previews.
    if (!isDesktopApp() && wantsNewTab(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget;
    const root = card.closest(".ProseMirror") ?? card;
    const { files, index } = collectEditorFiles(root, card);
    preview.open(
      files.length > 0 ? files : [{ url, name: filename, mimeType, size }],
      index,
    );
  };

  return (
    <NodeViewWrapper as="span" className="margaya-attachment-node">
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="margaya-attachment-card"
        title={filename}
        aria-label={t("common:filePreview.previewFile", { name: filename })}
        aria-disabled={url ? undefined : true}
        data-file-preview-url={url ?? undefined}
        data-file-preview-name={filename}
        data-file-preview-type={mimeType || undefined}
        data-file-preview-size={size || undefined}
        onClick={open}
        onAuxClick={(event) => {
          if (event.button === 1 && isDesktopApp()) open(event);
        }}
      >
        <FileTypeIcon name={filename} mimeType={mimeType} size={32} />
        <span className="margaya-attachment-card-content">
          <span className="margaya-attachment-card-title">{filename}</span>
          {meta && <span className="margaya-attachment-card-meta">{meta}</span>}
        </span>
      </a>
      {downloadLink && (
        // A sibling of the card, not inside it (links don't nest): it
        // downloads in place and never opens the preview.
        <a
          {...downloadLink}
          href={downloadLink.href}
          className="margaya-attachment-card-download"
          aria-label={t("common:files.download", { name: filename })}
          title={t("tasks:attachments.download")}
          draggable={false}
          onClick={stopHere}
          onAuxClick={stopHere}
        >
          <Download className="size-4" aria-hidden="true" />
        </a>
      )}
      {preview.dialog}
    </NodeViewWrapper>
  );
}

// The editor leaves pointer events on a card to the card: its click opens
// the preview, in editable and read-only editors alike, and no editor
// click handler (link opening, caret placement) sees it. Keys pressed on
// its focused links (Enter on Download) are theirs too, not the editor's.
function cardOwnsEvent({ event }: { event: Event }) {
  if (event.type.startsWith("key")) {
    return (
      event.target instanceof Element && event.target.closest("a") !== null
    );
  }
  return (
    event.type.startsWith("mouse") ||
    event.type.startsWith("pointer") ||
    event.type === "click" ||
    event.type === "auxclick"
  );
}

export const AttachmentCard = Node.create({
  name: "attachmentCard",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      url: { default: "" },
      filename: { default: "" },
      // Markdown stores it as `mime-type`, rendered HTML as `data-mime-type`;
      // HTML attribute names are lower-case, so `mimeType` itself never
      // matches.
      mimeType: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("mime-type") ??
          element.getAttribute("data-mime-type") ??
          element.getAttribute("mimetype") ??
          "",
      },
      size: { default: 0 },
    };
  },

  parseHTML() {
    return [
      { tag: "margaya-attachment[url]" },
      { tag: "span[data-type='attachment-card'][data-url]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "margaya-attachment",
      mergeAttributes(HTMLAttributes, {
        "data-type": "attachment-card",
        "data-url": HTMLAttributes.url,
        "data-filename": HTMLAttributes.filename,
        "data-mime-type": HTMLAttributes.mimeType,
        "data-size": HTMLAttributes.size,
        url: HTMLAttributes.url,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentCardView, {
      stopEvent: cardOwnsEvent,
    });
  },

  renderMarkdown(
    node: {
      attrs?: {
        url?: string;
        filename?: string;
        mimeType?: string;
        size?: number;
      };
    },
    _helpers: unknown,
    _context: unknown,
  ) {
    const url = String(node.attrs?.url || "");
    const filename = String(node.attrs?.filename || "");
    const mimeType = String(node.attrs?.mimeType || "");
    const size = Number(node.attrs?.size || 0);

    if (!url) return "";

    return `\n<margaya-attachment url="${escapeHtml(url)}" filename="${escapeHtml(filename)}" mime-type="${escapeHtml(mimeType)}" size="${size}" />\n`;
  },
});
