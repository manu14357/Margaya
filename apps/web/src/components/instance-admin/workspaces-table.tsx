import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableMeta,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactDate } from "@/components/ui/compact-date";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useInstanceWorkspaces } from "@/hooks/queries/instance-admin/use-instance-admin";
import { authClient } from "@/lib/auth-client";
import { formatDateMedium, formatNumber } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import type { InstanceWorkspace } from "@/types/instance-admin";
import { InstanceLoadState } from "./instance-page";

type WorkspacesTableProps = { q: string };

/** Every workspace on the instance, newest first, 25 at a time. */
export function WorkspacesTable({ q }: WorkspacesTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useInstanceWorkspaces(q);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  const open = async (workspace: InstanceWorkspace) => {
    // Admins may not be members; the API lets them in either way, so a
    // refused switch only leaves the previous workspace active.
    try {
      await authClient.organization.setActive({ organizationId: workspace.id });
    } catch {}
    navigate({
      to: "/dashboard/workspace/$workspaceId",
      params: { workspaceId: workspace.id },
    });
  };

  if (!query.data) {
    return (
      <InstanceLoadState
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {q.trim()
          ? t("instanceAdmin:workspaces.empty", { query: q.trim() })
          : t("instanceAdmin:workspaces.none")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <SettingsTable>
        <SettingsTableHeader>
          <SettingsTableRow>
            <SettingsTableHead>
              {t("instanceAdmin:workspaces.columns.name")}
            </SettingsTableHead>
            <SettingsTableHead>
              {t("instanceAdmin:workspaces.columns.owner")}
            </SettingsTableHead>
            <SettingsTableHead className="w-24" align="end" hideBelow="md">
              {t("instanceAdmin:workspaces.columns.members")}
            </SettingsTableHead>
            <SettingsTableHead className="w-24" align="end" hideBelow="md">
              {t("instanceAdmin:workspaces.columns.projects")}
            </SettingsTableHead>
            <SettingsTableHead className="w-28" hideBelow="md">
              {t("instanceAdmin:workspaces.columns.created")}
            </SettingsTableHead>
            <SettingsTableHead className="w-28">
              <span className="sr-only">{t("settings:table.actions")}</span>
            </SettingsTableHead>
          </SettingsTableRow>
        </SettingsTableHeader>
        <SettingsTableBody>
          {items.map((workspace) => (
            <SettingsTableRow key={workspace.id}>
              <SettingsTableCell kind="primary">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-7 shrink-0">
                    <AvatarImage src={workspace.logo ?? ""} alt="" />
                    <AvatarFallback className="text-[10px]">
                      {getInitials(workspace.name, "WS")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-medium text-sm">
                      <span className="min-w-0 wrap-break-word">
                        {workspace.name}
                      </span>
                      {workspace.deletionDueAt && (
                        <Badge variant="warning" className="shrink-0">
                          {t("settings:workspaceDeletion.admin.badge", {
                            date: formatDateMedium(workspace.deletionDueAt),
                          })}
                        </Badge>
                      )}
                    </p>
                    <TruncatedText
                      text={workspace.slug}
                      className="text-muted-foreground text-xs"
                    />
                    <SettingsTableMeta hideAbove="md">
                      <span>
                        {t("instanceAdmin:workspaces.columns.members")}{" "}
                        {formatNumber(workspace.memberCount)}
                      </span>
                      <span>
                        {t("instanceAdmin:workspaces.columns.projects")}{" "}
                        {formatNumber(workspace.projectCount)}
                      </span>
                      <CompactDate value={workspace.createdAt} />
                    </SettingsTableMeta>
                  </div>
                </div>
              </SettingsTableCell>
              <SettingsTableCell
                label={t("instanceAdmin:workspaces.columns.owner")}
              >
                {workspace.owner ? (
                  <div className="min-w-0">
                    <TruncatedText
                      text={workspace.owner.name}
                      className="text-sm"
                    />
                    <TruncatedText
                      text={workspace.owner.email}
                      middle
                      className="text-muted-foreground text-xs"
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("instanceAdmin:workspaces.noOwner")}
                  </span>
                )}
              </SettingsTableCell>
              <SettingsTableCell align="end" hideBelow="md">
                {formatNumber(workspace.memberCount)}
              </SettingsTableCell>
              <SettingsTableCell align="end" hideBelow="md">
                {formatNumber(workspace.projectCount)}
              </SettingsTableCell>
              <SettingsTableCell
                hideBelow="md"
                className="text-muted-foreground"
              >
                <CompactDate value={workspace.createdAt} />
              </SettingsTableCell>
              <SettingsTableCell kind="actions">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void open(workspace)}
                >
                  {t("instanceAdmin:workspaces.open")}
                </Button>
              </SettingsTableCell>
            </SettingsTableRow>
          ))}
        </SettingsTableBody>
      </SettingsTable>
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("instanceAdmin:workspaces.loadMore")}
        </Button>
      )}
    </div>
  );
}
