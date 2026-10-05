import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { PublicBoardsTable } from "@/components/instance-admin/public-boards-table";
import { SearchField } from "@/components/instance-admin/search-field";
import { SettingSwitchRow } from "@/components/instance-admin/setting-row";
import { Separator } from "@/components/ui/separator";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/public-boards",
)({
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <InstancePage
      title={t("instanceAdmin:publicBoards.title")}
      subtitle={t("instanceAdmin:publicBoards.subtitle")}
      locked={settings.data?.locked}
    >
      <InstanceSection title={t("instanceAdmin:publicBoards.title")}>
        {settings.data ? (
          <>
            <SettingSwitchRow
              settings={settings.data}
              settingKey="publicBoards.enabled"
              label={t("instanceAdmin:publicBoards.allow")}
              hint={t("instanceAdmin:publicBoards.allowHint")}
            />
            <Separator />
            <SettingSwitchRow
              settings={settings.data}
              settingKey="publicBoards.participation"
              label={t("instanceAdmin:publicBoards.participation")}
              hint={t("instanceAdmin:publicBoards.participationHint")}
            />
          </>
        ) : (
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={2}
          />
        )}
      </InstanceSection>

      <InstanceSection
        title={t("instanceAdmin:publicBoards.listTitle")}
        boxed={false}
        actions={
          <SearchField
            value={q}
            placeholder={t("instanceAdmin:publicBoards.search")}
            onChange={(next) =>
              navigate({
                search: { q: next.trim() || undefined },
                replace: true,
              })
            }
          />
        }
      >
        <PublicBoardsTable q={q} />
      </InstanceSection>
    </InstancePage>
  );
}
