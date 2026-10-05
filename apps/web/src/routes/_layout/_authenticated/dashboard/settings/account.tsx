import { createFileRoute, Outlet } from "@tanstack/react-router";

// The account pages' navigation lives in the settings frame (settings.tsx).
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account",
)({
  component: Outlet,
});
