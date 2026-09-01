import type { LucideIcon } from "lucide-react";
import { ChevronRight, Globe } from "lucide-react";
import type { ReactNode } from "react";
import { ProjectTile } from "../../replica";

/** The top bar's place for a project section: "Website › Cycle 12". */
export function ProjectCrumb({
  project,
  icon: Icon,
  children,
}: {
  project: ReactNode;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <>
      <ProjectTile icon={Globe} className="size-5" />
      <span className="shrink-0 font-medium text-muted-foreground">
        {project}
      </span>
      <ChevronRight
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground/70"
      />
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </>
  );
}
