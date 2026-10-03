import { createFileRoute } from "@tanstack/react-router";
import PublicBoardPage from "@/components/public-board/public-board-page";
import {
  type BoardSearch,
  parseBoardSearch,
} from "@/lib/public-board/search-params";

// The public board. The URL shape predates link tokens: boards public
// before publications existed use the project id as their token.
export const Route = createFileRoute("/public-project/$token")({
  validateSearch: (raw: Record<string, unknown>): BoardSearch =>
    parseBoardSearch(raw),
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <PublicBoardPage
      token={token}
      search={search}
      onSearchChange={(next) =>
        void navigate({ search: next, replace: true, resetScroll: false })
      }
    />
  );
}
