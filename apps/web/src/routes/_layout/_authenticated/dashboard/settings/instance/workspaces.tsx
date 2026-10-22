import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { PendingDeletionsSection } from "@/components/instance-admin/pending-deletions";
import { SearchField } from "@/components/instance-admin/search-field";
import { SettingSwitchRow } from "@/components/instance-admin/setting-row";
import { WorkspacesTable } from "@/components/instance-admin/workspaces-table";
import CreateWorkspaceModal from "@/components/shared/modals/create-workspace-modal";
import { Button } from "@/components/ui/button";
import {
  instanceAdminKeys,
  useInstanceSettings,
} from "@/hooks/queries/instance-admin/use-instance-admin";

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/workspaces",
)({
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  return (
    <InstancePage
      title={t("instanceAdmin:workspaces.title")}
      subtitle={t("instanceAdmin:workspaces.subtitle")}
      locked={settings.data?.locked}
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          {t("instanceAdmin:workspaces.create")}
        </Button>
      }
    >
      <InstanceSection title={t("instanceAdmin:workspaces.title")}>
        {settings.data ? (
          <SettingSwitchRow
            settings={settings.data}
            settingKey="workspaces.restrictCreation"
            label={t("instanceAdmin:workspaces.restrictCreation")}
            hint={t("instanceAdmin:workspaces.restrictCreationHint")}
          />
        ) : (
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={1}
          />
        )}
      </InstanceSection>

      <PendingDeletionsSection />

      <InstanceSection
        title={t("instanceAdmin:workspaces.listTitle")}
        boxed={false}
        actions={
          <SearchField
            value={q}
            placeholder={t("instanceAdmin:workspaces.search")}
            onChange={(next) =>
              navigate({
                search: { q: next.trim() || undefined },
                replace: true,
              })
            }
          />
        }
      >
        <WorkspacesTable q={q} />
      </InstanceSection>

      <CreateWorkspaceModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          void queryClient.invalidateQueries({
            queryKey: instanceAdminKeys.all,
          });
        }}
      />
    </InstancePage>
  );
}
