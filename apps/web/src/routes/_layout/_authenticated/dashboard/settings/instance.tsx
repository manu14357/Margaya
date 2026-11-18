import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { i18n } from "@/lib/i18n";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance",
)({
  beforeLoad: ({ context }) => {
    // The API checks the role from the database on every call; this only
    // keeps non-admins out of a screen that would answer 403 everywhere. When
    // the session fetch failed the role is unknown, so let the API decide.
    if (context.sessionError) return;
    if (context.session?.user?.role !== "admin") {
      throw redirect({ to: "/dashboard/settings/account/information" });
    }
  },
  // Its copy is a lazy namespace (lib/i18n/lazy-namespaces.ts): ready before
  // the first screen renders.
  loader: () => i18n.loadNamespaces("instanceAdmin"),
  // The navigation lives in the settings frame (settings.tsx).
  component: Outlet,
});
