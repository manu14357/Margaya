import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t("instanceAdmin:workspaces.columns.name")}
              </TableHead>
              <TableHead>
                {t("instanceAdmin:workspaces.columns.owner")}
              </TableHead>
              <TableHead className="text-right">
                {t("instanceAdmin:workspaces.columns.members")}
              </TableHead>
              <TableHead className="text-right">
                {t("instanceAdmin:workspaces.columns.projects")}
              </TableHead>
              <TableHead>
                {t("instanceAdmin:workspaces.columns.created")}
              </TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((workspace) => (
              <TableRow key={workspace.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className="size-7">
                      <AvatarImage src={workspace.logo ?? ""} alt="" />
                      <AvatarFallback className="text-[10px]">
                        {getInitials(workspace.name, "WS")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {workspace.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {workspace.slug}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {workspace.owner ? (
                    <div className="min-w-0">
                      <p className="truncate text-sm">{workspace.owner.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {workspace.owner.email}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("instanceAdmin:workspaces.noOwner")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(workspace.memberCount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(workspace.projectCount)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateMedium(workspace.createdAt)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void open(workspace)}
                  >
                    {t("instanceAdmin:workspaces.open")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
