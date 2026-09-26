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
import { getExternalWebUrl } from "@/lib/external-url";
import { fileKindIcon } from "@/lib/file-kind-icon";
import { formatRelativeTime } from "@/lib/format";
import { formatBytes } from "@/lib/format-bytes";

type TaskAttachmentRowProps = {
  attachment: TaskAttachment;
  canDelete: boolean;
  onDelete: () => void;
};

const rowClassName =
  "group/attachment flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50";

const iconLinkClassName = buttonVariants({ variant: "ghost", size: "icon-xs" });

function Preview({ attachment }: { attachment: TaskAttachment }) {
  const icon = fileKindIcon(attachment.mimeType, attachment.kind);
  if (icon === "image") {
    return (
      <img
        src={attachment.url}
        alt={attachment.filename}
        loading="lazy"
        className="size-8 shrink-0 rounded object-cover"
      />
    );
  }
  const Icon = icon;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

/** One attached file: preview, name, size, uploader and time, and actions. */
export default function TaskAttachmentRow({
  attachment,
  canDelete,
  onDelete,
}: TaskAttachmentRowProps) {
  const { t } = useTranslation();
  const openUrl =
    attachment.kind === "image" ? getExternalWebUrl(attachment.url) : null;
  const downloadUrl = getExternalWebUrl(attachment.downloadUrl);
  const size = formatBytes(attachment.size);
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
      <Preview attachment={attachment} />
      <div className="flex min-w-0 flex-1 flex-col">
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
      </div>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/attachment:opacity-100 pointer-coarse:opacity-100">
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("tasks:attachments.open")}
            title={t("tasks:attachments.open")}
            className={iconLinkClassName}
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            rel="noopener noreferrer"
            download={attachment.filename}
            aria-label={t("tasks:attachments.download")}
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
            className="hover:text-destructive-foreground"
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
