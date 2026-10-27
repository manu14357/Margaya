import { Link2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WidgetSection, {
  WidgetEmpty,
  WidgetError,
} from "@/components/home/widget-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { QuickLink } from "@/fetchers/quick-link/get-quick-links";
import { useDeleteQuickLink } from "@/hooks/mutations/quick-link/use-quick-link-mutations";
import useGetQuickLinks from "@/hooks/queries/quick-link/use-get-quick-links";
import { toast } from "@/lib/toast";
import QuickLinkCard from "./quick-link-card";
import QuickLinkDialog from "./quick-link-dialog";

const COLLAPSED_COUNT = 6;
const GRID = "grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3";

export default function QuickLinksWidget({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const {
    data: links,
    isLoading,
    isError,
    refetch,
  } = useGetQuickLinks({
    workspaceId,
  });
  const deleteLink = useDeleteQuickLink();
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QuickLink | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (link: QuickLink) => {
    setEditing(link);
    setDialogOpen(true);
  };

  const handleDelete = (link: QuickLink) => {
    deleteLink.mutate(
      { workspaceId, quickLinkId: link.id },
      {
        onSuccess: () => toast.success(t("home:quickLinks.toast.removed")),
        onError: () => toast.error(t("home:quickLinks.toast.removeError")),
      },
    );
  };

  const visible = expanded ? links : links?.slice(0, COLLAPSED_COUNT);

  return (
    <WidgetSection
      title={t("home:widgets.quickLinks")}
      icon={Link2}
      tone="var(--area-inbox)"
      actions={
        <Button variant="ghost" size="xs" onClick={openAdd}>
          <Plus />
          {t("home:quickLinks.add")}
        </Button>
      }
    >
      {isLoading ? (
        <div className={GRID}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <WidgetError
          message={t("home:quickLinks.loadError")}
          retryLabel={t("home:retry")}
          onRetry={() => void refetch()}
        />
      ) : !links || links.length === 0 ? (
        <WidgetEmpty>{t("home:quickLinks.empty")}</WidgetEmpty>
      ) : (
        <div className="space-y-2">
          <div className={GRID}>
            {visible?.map((link) => (
              <QuickLinkCard
                key={link.id}
                link={link}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
          {links.length > COLLAPSED_COUNT && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? t("home:quickLinks.showLess")
                : t("home:quickLinks.showAll", { count: links.length })}
            </Button>
          )}
        </div>
      )}

      <QuickLinkDialog
        workspaceId={workspaceId}
        link={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </WidgetSection>
  );
}
