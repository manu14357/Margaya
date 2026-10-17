import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInstancePendingDeletions } from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatDateMedium } from "@/lib/format";
import { InstanceSection } from "./instance-page";

/**
 * Workspaces their owners scheduled for deletion: read-only until the date,
 * then purged. Hidden while there are none.
 */
export function PendingDeletionsSection() {
  const { t } = useTranslation();
  const query = useInstancePendingDeletions();
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <InstanceSection
      title={t("settings:workspaceDeletion.admin.title")}
      description={t("settings:workspaceDeletion.admin.description")}
      boxed={false}
    >
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
              <TableHead>
                {t("settings:workspaceDeletion.admin.dueAt")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((workspace) => (
              <TableRow key={workspace.id}>
                <TableCell>
                  <p className="truncate font-medium text-sm">
                    {workspace.name}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {workspace.slug}
                  </p>
                </TableCell>
                <TableCell>
                  {workspace.owner ? (
                    <p className="truncate text-sm">
                      {workspace.owner.name || workspace.owner.email}
                    </p>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {t("instanceAdmin:workspaces.noOwner")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {workspace.deletionDueAt
                    ? formatDateMedium(workspace.deletionDueAt)
                    : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </InstanceSection>
  );
}
