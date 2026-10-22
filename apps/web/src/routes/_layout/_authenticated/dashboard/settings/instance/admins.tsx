import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddAdminDialog } from "@/components/instance-admin/add-admin-dialog";
import { AdminsTable } from "@/components/instance-admin/admins-table";
import { AuditTrail } from "@/components/instance-admin/audit-trail";
import {
  InstanceLoadState,
  InstancePage,
} from "@/components/instance-admin/instance-page";
import { Button } from "@/components/ui/button";
import { useInstanceAdmins } from "@/hooks/queries/instance-admin/use-instance-admin";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/admins",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const admins = useInstanceAdmins();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <InstancePage
      title={t("instanceAdmin:admins.title")}
      subtitle={t("instanceAdmin:admins.subtitle")}
      actions={
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus />
          {t("instanceAdmin:admins.add")}
        </Button>
      }
    >
      {admins.data ? (
        <AdminsTable admins={admins.data} />
      ) : (
        <InstanceLoadState
          isLoading={admins.isLoading}
          isError={admins.isError}
          onRetry={() => void admins.refetch()}
        />
      )}
      <AuditTrail />
      <AddAdminDialog open={addOpen} onOpenChange={setAddOpen} />
    </InstancePage>
  );
}
