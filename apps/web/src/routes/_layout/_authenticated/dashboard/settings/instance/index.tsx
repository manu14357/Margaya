import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/",
)({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/settings/instance/general" });
  },
});
