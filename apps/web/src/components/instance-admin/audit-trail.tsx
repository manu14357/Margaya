import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInstanceAuditLog } from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatDateTime } from "@/lib/format";
import { INSTANCE_AUDIT_ACTION_KEYS } from "@/lib/instance-audit";
import { InstanceLoadState, InstanceSection } from "./instance-page";

/** The instance audit trail: who changed what on the instance, and when. */
export function AuditTrail() {
  const { t } = useTranslation();
  const audit = useInstanceAuditLog();
  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  const actionLabel = (action: string) => {
    const key =
      INSTANCE_AUDIT_ACTION_KEYS[
        action as keyof typeof INSTANCE_AUDIT_ACTION_KEYS
      ];
    return key ? t(key) : action;
  };

  return (
    <InstanceSection
      title={t("accountSecurity:auditTrail.title")}
      description={t("accountSecurity:auditTrail.subtitle")}
      boxed={false}
    >
      {!audit.data ? (
        <InstanceLoadState
          isLoading={audit.isLoading}
          isError={audit.isError}
          onRetry={() => void audit.refetch()}
        />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("accountSecurity:auditTrail.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accountSecurity:auditTrail.when")}</TableHead>
                  <TableHead>{t("accountSecurity:auditTrail.who")}</TableHead>
                  <TableHead>{t("accountSecurity:auditTrail.what")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <time dateTime={String(entry.createdAt)}>
                        {formatDateTime(entry.createdAt)}
                      </time>
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.actorName ??
                        (entry.actorType === "system"
                          ? t("accountSecurity:auditTrail.system")
                          : "—")}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span>{actionLabel(entry.action)}</span>
                      {entry.targetLabel ? (
                        <span className="text-muted-foreground">
                          {" · "}
                          {entry.targetLabel}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {audit.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              loading={audit.isFetchingNextPage}
              onClick={() => void audit.fetchNextPage()}
            >
              {t("accountSecurity:auditTrail.loadMore")}
            </Button>
          ) : null}
        </div>
      )}
    </InstanceSection>
  );
}
