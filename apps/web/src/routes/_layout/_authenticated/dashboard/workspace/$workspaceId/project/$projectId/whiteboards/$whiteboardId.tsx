import { createFileRoute } from "@tanstack/react-router";
import WhiteboardScreen from "@/components/whiteboard/whiteboard-screen";

type WhiteboardSearchParams = { element?: string };

// Element ids are short url-safe strings; anything else is ignored.
const ELEMENT_ID = /^[\w-]{1,64}$/;

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): WhiteboardSearchParams => ({
    element:
      typeof search.element === "string" && ELEMENT_ID.test(search.element)
        ? search.element
        : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, projectId, whiteboardId } = Route.useParams();
  const { element } = Route.useSearch();
  return (
    <WhiteboardScreen
      key={whiteboardId}
      workspaceId={workspaceId}
      projectId={projectId}
      whiteboardId={whiteboardId}
      elementId={element}
    />
  );
}
