import { Copy, Ellipsis, Link2, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TaskLink } from "@/fetchers/task-link/get-task-links";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { getExternalWebUrl } from "@/lib/external-url";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { isGithubHost } from "@/lib/link-url";
import { toast } from "@/lib/toast";

type TaskLinkRowProps = {
  link: TaskLink;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

/**
 * One web link: its title (or host), the real host, who added it and when.
 * The host is always shown, so a misleading title can't hide the
 * destination; the stored URL is checked again before it becomes a link.
 */
export default function TaskLinkRow({
  link,
  canEdit,
  onEdit,
  onRemove,
}: TaskLinkRowProps) {
  const { t } = useTranslation();
  const href = getExternalWebUrl(link.url);
  const label = link.title || link.host || link.url;
  const Icon = isGithubHost(link.host) ? GithubIcon : Link2;
  const addedAt = formatDateTime(link.createdAt);
  const labelContent = (
    <>
      <span className="truncate text-foreground/90 text-sm">{label}</span>
      <span className="shrink-0 truncate text-muted-foreground text-xs">
        {link.host}
      </span>
    </>
  );

  const handleCopy = async () => {
    if (await copyToClipboard(link.url)) {
      toast.success(t("tasks:links.toast.copied"));
    } else {
      toast.error(t("tasks:taskKey.clipboardError"));
    }
  };

  return (
    <div className="group/link relative flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger asChild>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              referrerPolicy="no-referrer"
              className="flex min-w-0 flex-1 items-baseline gap-2 outline-none after:absolute after:inset-0 focus-visible:underline"
            >
              {labelContent}
            </a>
          ) : (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              {labelContent}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-sm break-all">
          {link.url}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <span className="relative z-10 shrink-0 whitespace-nowrap text-muted-foreground/80 text-xs" />
          }
        >
          {formatRelativeTime(link.createdAt)}
        </TooltipTrigger>
        <TooltipContent>
          {link.createdBy
            ? t("tasks:links.addedBy", {
                name: link.createdBy.name,
                date: addedAt,
              })
            : t("tasks:links.addedAt", { date: addedAt })}
        </TooltipContent>
      </Tooltip>

      <span className="relative z-10 flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/link:opacity-100 pointer-coarse:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("tasks:links.copyUrl")}
          title={t("tasks:links.copyUrl")}
          onClick={() => void handleCopy()}
        >
          <Copy className="size-3.5" />
        </Button>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("tasks:links.moreActions")}
                  title={t("tasks:links.moreActions")}
                />
              }
            >
              <Ellipsis className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem className="gap-2" onClick={onEdit}>
                <Pencil className="size-3.5" />
                {t("tasks:links.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-destructive-foreground"
                onClick={onRemove}
              >
                <Trash2 className="size-3.5" />
                {t("tasks:links.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </div>
  );
}
