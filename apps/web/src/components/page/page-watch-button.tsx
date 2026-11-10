import { Bell, BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTogglePageSubscription } from "@/hooks/mutations/page/use-page-comment-mutations";
import { usePageSubscription } from "@/hooks/queries/page/use-page-comments";
import { toast } from "@/lib/toast";

/** Watch a page or stop watching it. Sits inside the toolbar's tooltip provider. */
export default function PageWatchButton({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const { data, isPending } = usePageSubscription(pageId);
  const toggle = useTogglePageSubscription(pageId);

  if (isPending) return <Skeleton className="size-7" />;
  if (!data) return null;

  const watching = data.subscribed;
  const label = watching ? t("pages:watch.unwatch") : t("pages:watch.watch");
  const Icon = watching ? BellRing : Bell;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={watching}
            className="text-muted-foreground"
            onClick={() => {
              if (toggle.isPending) return;
              toggle.mutate(!watching, {
                onError: () => toast.error(t("pages:watch.error")),
              });
            }}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>
        {watching ? t("pages:watch.watchingHint") : t("pages:watch.watchHint")}
      </TooltipContent>
    </Tooltip>
  );
}

/** The same toggle as an entry in the page menu (a crowded top bar). */
export function PageWatchMenuItem({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const { data } = usePageSubscription(pageId);
  const toggle = useTogglePageSubscription(pageId);
  if (!data) return null;

  const watching = data.subscribed;
  const Icon = watching ? BellRing : Bell;
  return (
    <DropdownMenuItem
      onClick={() => {
        if (toggle.isPending) return;
        toggle.mutate(!watching, {
          onError: () => toast.error(t("pages:watch.error")),
        });
      }}
    >
      <Icon />
      {watching ? t("pages:watch.unwatch") : t("pages:watch.watch")}
    </DropdownMenuItem>
  );
}
