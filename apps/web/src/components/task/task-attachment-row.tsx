import { FileTypeIcon, fileTypeLabel } from "@margaya/file-preview";
import { Download, ExternalLink, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TaskAttachment } from "@/fetchers/task-attachment/get-task-attachments";
import { cn } from "@/lib/cn";
import { isDesktopApp } from "@/lib/desktop";
import { fileDownloadLinkProps } from "@/lib/file-download";
import {
  type PreviewFile,
  previewKind,
  resolveFileUrl,
} from "@/lib/file-preview";
import { formatRelativeTime } from "@/lib/format";
import { formatBytes } from "@/lib/format-bytes";

type TaskAttachmentRowProps = {
  attachment: TaskAttachment;
  canDelete: boolean;
  onDelete: () => void;
  /** Opens the file preview on this attachment. */
  onPreview: () => void;
};

/** The preview's view of an attachment, or null without a usable URL. */
export function attachmentPreviewFile(
  attachment: TaskAttachment,
): PreviewFile | null {
  const url = resolveFileUrl(attachment.url);
  if (!url) return null;
  return {
    url,
    name: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(attachment.kind === "image" ? { kind: "image" as const } : {}),
  };
}

const rowClassName =
  "group/attachment flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50";

const iconLinkClassName = buttonVariants({ variant: "ghost", size: "icon-xs" });

// Secondary actions show on hover or focus where there is a mouse, and
// always on touch screens. Download is never hidden.
const revealClassName =
  "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/attachment:opacity-100 group-hover/attachment:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none";

function Preview({ attachment }: { attachment: TaskAttachment }) {
  // An image shows itself; any other file its type.
  if (attachment.kind === "image") {
    return (
      <img
        src={attachment.url}
        alt={attachment.filename}
        loading="lazy"
        className="size-8 shrink-0 rounded object-cover"
      />
    );
  }
  return (
    <FileTypeIcon
      name={attachment.filename}
      mimeType={attachment.mimeType}
      size={32}
    />
  );
}

/** One attached file: preview, name, size, uploader and time, and actions. */
export default function TaskAttachmentRow({
  attachment,
  canDelete,
  onDelete,
  onPreview,
}: TaskAttachmentRowProps) {
  const { t } = useTranslation();
  const file = attachmentPreviewFile(attachment);
  // A new tab where there are tabs, for what the browser can show; the
  // desktop app previews instead of opening a bare window.
  const openUrl =
    file && !isDesktopApp() && previewKind(file) !== "none" ? file.url : null;
  // The server's own download link, else one made from the file's link.
  const serverDownloadUrl = resolveFileUrl(attachment.downloadUrl);
  const download = serverDownloadUrl
    ? { href: serverDownloadUrl, download: attachment.filename }
    : file
      ? fileDownloadLinkProps(file.url, attachment.filename)
      : null;
  const type = fileTypeLabel({
    name: attachment.filename,
    mimeType: attachment.mimeType,
  });
  const bytes = formatBytes(attachment.size);
  const size = type && bytes ? `${type} · ${bytes}` : type || bytes;
  const time = formatRelativeTime(attachment.createdAt);
  const meta = attachment.createdBy
    ? t("tasks:attachments.meta", {
        size,
        name: attachment.createdBy.name,
        time,
      })
    : t("tasks:attachments.metaNoUser", { size, time });

  return (
    <div className={rowClassName}>
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm text-start outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        aria-label={t("common:filePreview.previewFile", {
          name: attachment.filename,
        })}
        disabled={!file}
        onClick={onPreview}
      >
        <Preview attachment={attachment} />
        <span className="flex min-w-0 flex-1 flex-col">
          <Tooltip>
            <TooltipTrigger
              render={<span className="truncate text-foreground/90 text-sm" />}
            >
              {attachment.filename}
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-all">
              {attachment.filename}
            </TooltipContent>
          </Tooltip>
          <span className="truncate text-muted-foreground text-xs">{meta}</span>
        </span>
      </button>
      <span className="flex shrink-0 items-center">
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("common:filePreview.openInNewTab")}
            title={t("common:filePreview.openInNewTab")}
            className={cn(iconLinkClassName, revealClassName)}
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {download && (
          // Same window: this server answers with an attachment, so the
          // page stays (and the desktop app saves it as a download).
          <a
            {...download}
            href={download.href}
            aria-label={t("common:files.download", {
              name: attachment.filename,
            })}
            title={t("tasks:attachments.download")}
            className={iconLinkClassName}
          >
            <Download className="size-3.5" />
          </a>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn("hover:text-destructive-foreground", revealClassName)}
            aria-label={t("tasks:attachments.delete")}
            title={t("tasks:attachments.delete")}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </span>
    </div>
  );
}

/** A file on its way up: spinner, name and "Uploading…". */
export function PendingAttachmentRow({ filename }: { filename: string }) {
  const { t } = useTranslation();
  return (
    <div className={rowClassName} aria-busy="true">
      <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
        <Spinner className="size-4 text-muted-foreground" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground/90 text-sm">{filename}</span>
        <span className="text-muted-foreground text-xs">
          {t("tasks:attachments.uploading")}
        </span>
      </div>
    </div>
  );
}
