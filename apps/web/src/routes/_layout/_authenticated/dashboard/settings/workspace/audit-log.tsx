import { createFileRoute } from "@tanstack/react-router";
import { AuditLogPage } from "@/components/audit-log/audit-log-page";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/audit-log",
)({
  component: AuditLogPage,
});
