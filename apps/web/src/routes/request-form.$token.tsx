import { createFileRoute } from "@tanstack/react-router";
import RequestFormPage from "@/components/request-form/request-form-page";

// The public request form (#8). Outside the signed-in layout: anyone with
// the link can send a request; nothing of the workspace is shown.
export const Route = createFileRoute("/request-form/$token")({
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useParams();
  return <RequestFormPage token={token} />;
}
