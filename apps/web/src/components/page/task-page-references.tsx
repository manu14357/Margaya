import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useGetTaskPageReferences } from "@/hooks/queries/page/use-get-task-page-references";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import PageLogo from "./page-logo";

type TaskPageReferencesProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
};

/**
 * "Mentioned in pages" on the task detail: the visible pages that mention or
 * link the task. Rendered only with the project's Pages feature on, page
 * read access and at least one page.
 */
export function TaskPageReferences({
  taskId,
  projectId,
  workspaceId,
}: TaskPageReferencesProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const { canReadPages } = useWorkspacePermission();
  const enabled = isEnabled("pages") && canReadPages();
  const { data: pages = [] } = useGetTaskPageReferences(taskId, enabled);

  if (!enabled || pages.length === 0) return null;

  const untitled = t("pages:list.untitled");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <div className="flex items-center gap-1.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <span>{t("tasks:pageReferences.title")}</span>
          </button>
        </CollapsibleTrigger>
        <span className="text-muted-foreground text-xs">{pages.length}</span>
      </div>

      <CollapsibleContent>
        <ul className="mt-1 flex flex-col">
          {pages.map((page) => (
            <li key={page.id}>
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
                params={{
                  workspaceId,
                  projectId: page.projectId ?? projectId,
                  pageId: page.id,
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
              >
                <PageLogo logoKind={page.logoKind} logoValue={page.logoValue} />
                <span className="truncate">
                  {page.title.trim() || untitled}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default TaskPageReferences;
