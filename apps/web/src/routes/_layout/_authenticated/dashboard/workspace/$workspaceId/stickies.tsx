import { createFileRoute } from "@tanstack/react-router";
import StickiesPage from "@/components/sticky/stickies-page";

type StickiesSearchParams = {
  /** Set by the palette's "New sticky": create one once the list loads. */
  new?: boolean;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/stickies",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): StickiesSearchParams => ({
    new: search.new === true || search.new === "true" ? true : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { new: createOnLoad } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <StickiesPage
      workspaceId={workspaceId}
      createOnLoad={createOnLoad === true}
      onCreateHandled={() =>
        navigate({ search: { new: undefined }, replace: true })
      }
    />
  );
}
