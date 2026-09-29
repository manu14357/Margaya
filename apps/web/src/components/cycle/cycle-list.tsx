import {
  Archive,
  CalendarClock,
  CircleCheck,
  CircleDot,
  IterationCw,
  Plus,
  SearchX,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CollapsibleSection,
  PlanningRowSkeletons,
} from "@/components/planning/collapsible-section";
import { PlanningLoadError } from "@/components/planning/planning-page-states";
import {
  isBooleanRecord,
  useStoredState,
} from "@/components/planning/use-stored-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import { searchCycles, sectionCycles } from "@/lib/cycle/order";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import ActiveCyclePanel from "./active-cycle-panel";
import CycleRow from "./cycle-row";

type SectionId = "active" | "upcoming" | "completed";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  active: true,
  upcoming: true,
  completed: true,
};

type CycleListProps = {
  projectId: string;
  workspaceId: string;
  view: "cycles" | "archived";
  query: string;
  /** Present when the user may create cycles. */
  onCreate?: () => void;
};

function CycleRows({
  cycles,
  workspaceId,
}: {
  cycles: Cycle[];
  workspaceId: string;
}) {
  return (
    <div className="divide-y divide-border/50">
      {cycles.map((cycle) => (
        <CycleRow key={cycle.id} cycle={cycle} workspaceId={workspaceId} />
      ))}
    </div>
  );
}

/** The project's cycles: the running one, upcoming and completed; or archived. */
export default function CycleList({
  projectId,
  workspaceId,
  view,
  query,
  onCreate,
}: CycleListProps) {
  const { t } = useTranslation();
  const isArchived = view === "archived";
  const { data, isLoading, isError, refetch } = useGetCycles(
    projectId,
    isArchived ? "archived" : "all",
  );
  const [openSections, setOpenSections] = useStoredState(
    `margaya:cycle-sections:${projectId}`,
    DEFAULT_OPEN,
    isBooleanRecord,
  );

  useEffect(() => {
    if (isError) toast.error(t("cycles:toast.loadError"));
  }, [isError, t]);

  const toggle = (section: SectionId) =>
    setOpenSections({
      ...DEFAULT_OPEN,
      ...openSections,
      [section]: !(openSections[section] ?? true),
    });
  const isOpen = (section: SectionId) => openSections[section] ?? true;

  if (isError) {
    return (
      <PlanningLoadError
        message={t("cycles:toast.loadError")}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div>
        {(isArchived ? ["archived"] : ["active", "upcoming", "completed"]).map(
          (section) => (
            <div key={section} className="border-border/50 border-b">
              <div className="bg-muted/60 px-4 py-2.5">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              </div>
              <PlanningRowSkeletons />
            </div>
          ),
        )}
      </div>
    );
  }

  const cycles = searchCycles(data, query);

  if (data.length === 0) {
    return (
      <Empty className="min-h-[50vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {isArchived ? <Archive /> : <IterationCw />}
          </EmptyMedia>
          <EmptyTitle>
            {isArchived
              ? t("cycles:empty.archivedTitle")
              : t("cycles:empty.title")}
          </EmptyTitle>
          <EmptyDescription>
            {isArchived
              ? t("cycles:empty.archivedDescription")
              : t("cycles:empty.description")}
          </EmptyDescription>
        </EmptyHeader>
        {!isArchived && onCreate && (
          <EmptyContent>
            <Button onClick={onCreate}>
              <Plus />
              {t("cycles:empty.cta")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  if (cycles.length === 0) {
    return (
      <Empty className="min-h-[40vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>
            {t("cycles:empty.searchTitle", { query: query.trim() })}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  if (isArchived) {
    return <CycleRows cycles={cycles} workspaceId={workspaceId} />;
  }

  const { active, upcoming, completed } = sectionCycles(cycles);

  return (
    <div>
      <CollapsibleSection
        title={t("cycles:sections.active")}
        icon={CircleDot}
        open={isOpen("active")}
        onToggle={() => toggle("active")}
      >
        <div className="p-4">
          <ActiveCyclePanel
            cycle={active}
            projectId={projectId}
            workspaceId={workspaceId}
            onCreate={onCreate}
          />
        </div>
      </CollapsibleSection>
      {upcoming.length > 0 && (
        <CollapsibleSection
          title={t("cycles:sections.upcoming")}
          icon={CalendarClock}
          count={upcoming.length}
          open={isOpen("upcoming")}
          onToggle={() => toggle("upcoming")}
        >
          <CycleRows cycles={upcoming} workspaceId={workspaceId} />
        </CollapsibleSection>
      )}
      {completed.length > 0 && (
        <CollapsibleSection
          title={t("cycles:sections.completed")}
          icon={CircleCheck}
          count={completed.length}
          open={isOpen("completed")}
          onToggle={() => toggle("completed")}
        >
          <CycleRows cycles={completed} workspaceId={workspaceId} />
        </CollapsibleSection>
      )}
    </div>
  );
}
