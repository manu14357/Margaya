import {
  Copy,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { QuickLink } from "@/fetchers/quick-link/get-quick-links";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { openExternalWebUrl } from "@/lib/external-url";
import { displayHost } from "@/lib/link-url";
import { toast } from "@/lib/toast";

/** The URL as shown when a link has no title: without its scheme. */
export function urlWithoutScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

type QuickLinkCardProps = {
  link: QuickLink;
  onEdit: (link: QuickLink) => void;
  onDelete: (link: QuickLink) => void;
};

export default function QuickLinkCard({
  link,
  onEdit,
  onDelete,
}: QuickLinkCardProps) {
  const { t } = useTranslation();
  const label = link.title || urlWithoutScheme(link.url);

  const handleCopy = async () => {
    if (await copyToClipboard(link.url)) {
      toast.success(t("home:quickLinks.toast.copied"));
    }
  };

  return (
    <div className="group relative flex h-14 items-center rounded-lg border border-border bg-card transition-colors hover:bg-accent/40">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg ps-3 pe-9 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openExternalWebUrl(link.url)}
            />
          }
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
            <Link2 className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {displayHost(link.url)}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 break-all">
          {link.url}
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("home:quickLinks.menu")}
              className="absolute end-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => onEdit(link)}>
            <Pencil />
            {t("home:quickLinks.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openExternalWebUrl(link.url)}>
            <ExternalLink />
            {t("home:quickLinks.openInNewTab")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleCopy()}>
            <Copy />
            {t("home:quickLinks.copy")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(link)}
          >
            <Trash2 />
            {t("home:quickLinks.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
