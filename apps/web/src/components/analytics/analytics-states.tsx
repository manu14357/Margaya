import { ChartColumn, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

/** Reached only by a direct link: the entries are hidden without access. */
export function AnalyticsNoAccess() {
  const { t } = useTranslation();
  return (
    <Empty className="min-h-[60vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ChartColumn />
        </EmptyMedia>
        <EmptyTitle>{t("analytics:states.noAccessTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("analytics:states.noAccessDescription")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A workspace without projects has nothing to count yet. */
export function AnalyticsEmptyWorkspace({ canCreate }: { canCreate: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Empty className="min-h-[60vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartColumn />
          </EmptyMedia>
          <EmptyTitle>{t("analytics:states.noProjectsTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("analytics:states.noProjectsDescription")}
          </EmptyDescription>
        </EmptyHeader>
        {canCreate && (
          <EmptyContent>
            <Button onClick={() => setOpen(true)}>
              <Plus />
              {t("analytics:states.newProject")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
      {canCreate && (
        <CreateProjectModal open={open} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** While permissions and projects load: the tab strip and a few tiles. */
export function AnalyticsPageSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-3 px-4 py-4 md:px-6 md:py-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={index} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
