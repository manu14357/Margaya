import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import type { CreateProjectFlowProps } from "@/components/create-project/create-project-flow";
import { prefetchProjectTemplates } from "@/hooks/queries/project-template/use-project-templates";
import { useLocale } from "@/hooks/use-locale";

const loadFlow = () =>
  import("@/components/create-project/create-project-flow");
const CreateProjectFlow = lazy(loadFlow);

/**
 * The project create flow for every entry point (sidebar, projects page,
 * Home, analytics, the command palette). The gallery is its own chunk,
 * loaded the first time the flow opens or an entry point is hovered; after
 * that it stays mounted, so it opens and closes like any dialog.
 */
export default function CreateProjectModal(props: CreateProjectFlowProps) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;

  return (
    <Suspense fallback={null}>
      <CreateProjectFlow {...props} />
    </Suspense>
  );
}

/**
 * Hover or focus handlers for a "New project" control: they load the flow's
 * code and the template catalog before the click.
 */
export function usePreloadCreateProject() {
  const queryClient = useQueryClient();
  const { locale } = useLocale();
  return () => {
    void loadFlow();
    void prefetchProjectTemplates(queryClient, locale);
  };
}
