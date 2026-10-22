import { createFileRoute } from "@tanstack/react-router";
import PublicPageView from "@/components/public-page/public-page-view";

// A page published to a read-only public link. No sign-in, no app chrome.
export const Route = createFileRoute("/public-page/$token")({
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useParams();
  return <PublicPageView token={token} />;
}
