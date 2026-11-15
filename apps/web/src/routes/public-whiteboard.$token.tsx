import { createFileRoute } from "@tanstack/react-router";
import PublicWhiteboardView from "@/components/public-whiteboard/public-whiteboard-view";

// A board published to a read-only public link. No sign-in, no app chrome.
export const Route = createFileRoute("/public-whiteboard/$token")({
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useParams();
  return <PublicWhiteboardView token={token} />;
}
