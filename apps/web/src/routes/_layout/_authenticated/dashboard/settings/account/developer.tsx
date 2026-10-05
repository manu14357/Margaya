import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiKeyCreatedModal } from "@/components/settings/api-key-created-modal";
import { ApiKeyTable } from "@/components/settings/api-key-table";
import { CreateApiKeyDialog } from "@/components/settings/create-api-key-dialog";
import { SettingsPage, SettingsSection } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import useGetApiKeys from "@/hooks/queries/use-get-api-keys";
import type { CreateApiKeyResponse } from "@/types/api-key";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/developer",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { data: apiKeys = [], isLoading } = useGetApiKeys();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<{
    key: string;
    name: string;
  } | null>(null);

  const handleCreateSuccess = (data: CreateApiKeyResponse) => {
    setCreatedKey({
      key: data.key,
      name: data.name || t("settings:developerPage.unnamedKey"),
    });
  };

  const handleCreatedModalClose = () => {
    setCreatedKey(null);
  };

  return (
    <SettingsPage
      title={t("settings:developerPage.title")}
      documentTitle={t("settings:developerPage.pageTitle")}
      description={t("settings:developerPage.subtitle")}
      actions={
        <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus />
          {t("settings:developerPage.createApiKey")}
        </Button>
      }
    >
      <SettingsSection
        title={t("settings:developerPage.apiKeysCardTitle")}
        description={t("settings:developerPage.apiKeysCardDescription")}
      >
        <ApiKeyTable apiKeys={apiKeys} isLoading={isLoading} />
      </SettingsSection>

      <CreateApiKeyDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      {createdKey && (
        <ApiKeyCreatedModal
          apiKey={createdKey.key}
          keyName={createdKey.name}
          open={true}
          onClose={handleCreatedModalClose}
        />
      )}
    </SettingsPage>
  );
}
