import { Activity, KeyRound, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsEmptyState } from "@/components/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import useDeleteApiKey from "@/hooks/mutations/api-key/use-delete-api-key";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { ApiKey } from "@/types/api-key";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { TruncatedText } from "../ui/truncated-text";
import { ApiKeyRequestsSheet } from "./api-key-requests-sheet";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableMeta,
  SettingsTableRow,
} from "./settings-table";

type ApiKeyTableProps = {
  apiKeys: ApiKey[];
  isLoading: boolean;
};

function formatDate(value: Date | string | null) {
  if (!value) return "-";

  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** "Never", or how long ago with the exact time in a tooltip. */
function LastUsed({ value }: { value: Date | string | null | undefined }) {
  const { t } = useTranslation();
  if (!value) {
    return (
      <span className="text-muted-foreground">
        {t("settings:apiKey.table.neverUsed")}
      </span>
    );
  }

  const date = new Date(value);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={date.toISOString()}
            className="cursor-default whitespace-nowrap text-muted-foreground"
          />
        }
      >
        {formatRelativeTime(date)}
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(date)}</TooltipContent>
    </Tooltip>
  );
}

const SCOPE_KEYS = {
  full: "accountSecurity:platform.apiKeys.scopeFull",
  read: "accountSecurity:platform.apiKeys.scopeRead",
  custom: "accountSecurity:platform.apiKeys.scopeCustom",
} as const;

/** Full access, read-only or custom, and the projects it is limited to. */
function ScopeSummary({ scope }: { scope: ApiKey["scope"] | undefined }) {
  const { t } = useTranslation();
  if (!scope) return null;
  const projects = scope.projects?.map(
    (project) =>
      project.name ?? t("accountSecurity:platform.apiKeys.deletedProject"),
  );
  return (
    <div className="space-y-0.5">
      <Badge variant={scope.access === "full" ? "outline" : "secondary"}>
        {t(SCOPE_KEYS[scope.access])}
      </Badge>
      {projects && projects.length > 0 && (
        <TruncatedText
          text={t("accountSecurity:platform.apiKeys.scopeProjects", {
            projects: projects.join(", "),
          })}
          className="text-muted-foreground text-xs"
        />
      )}
    </div>
  );
}

export function ApiKeyTable({ apiKeys, isLoading }: ApiKeyTableProps) {
  const { t } = useTranslation();
  const [requestsKey, setRequestsKey] = useState<ApiKey | null>(null);
  const { mutateAsync: deleteApiKey } = useDeleteApiKey();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const getExpirationState = (expiresAt: Date | string | null) => {
    if (!expiresAt) {
      return { label: t("common:formats.never"), isExpired: false };
    }

    const expirationDate = new Date(expiresAt);
    const isExpired = expirationDate.getTime() <= Date.now();

    return {
      label: formatDate(expirationDate),
      isExpired,
    };
  };

  const pendingDeleteKey = useMemo(
    () => apiKeys.find((key) => key.id === pendingDeleteId) ?? null,
    [apiKeys, pendingDeleteId],
  );

  const handleDelete = async () => {
    if (!pendingDeleteKey) return;

    setDeletingId(pendingDeleteKey.id);
    try {
      await deleteApiKey(pendingDeleteKey.id);
      toast.success(t("settings:apiKey.table.toastDeleted"));
      setPendingDeleteId(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:apiKey.table.toastDeleteError"),
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4" aria-busy="true">
        <span className="sr-only">{t("settings:apiKey.table.loading")}</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (apiKeys.length === 0) {
    return (
      <SettingsEmptyState
        icon={<KeyRound />}
        title={t("settings:apiKey.table.empty")}
      />
    );
  }

  return (
    <>
      <SettingsTable>
        <SettingsTableHeader>
          <SettingsTableRow>
            <SettingsTableHead>
              {t("settings:apiKey.table.columnName")}
            </SettingsTableHead>
            <SettingsTableHead className="w-40">
              {t("accountSecurity:platform.apiKeys.columnScope")}
            </SettingsTableHead>
            <SettingsTableHead className="w-28" hideBelow="md">
              {t("settings:apiKey.table.columnCreated")}
            </SettingsTableHead>
            <SettingsTableHead className="w-32" hideBelow="md">
              {t("settings:apiKey.table.columnExpires")}
            </SettingsTableHead>
            <SettingsTableHead className="w-32">
              {t("settings:apiKey.table.columnLastUsed")}
            </SettingsTableHead>
            <SettingsTableHead className="w-24">
              <span className="sr-only">
                {t("settings:apiKey.table.columnActions")}
              </span>
            </SettingsTableHead>
          </SettingsTableRow>
        </SettingsTableHeader>
        <SettingsTableBody>
          {apiKeys.map((apiKey) => {
            const expiration = getExpirationState(apiKey.expiresAt);
            const expires = expiration.isExpired ? (
              <Badge variant="error">
                {t("settings:apiKey.table.expiredBadge", {
                  label: expiration.label,
                })}
              </Badge>
            ) : (
              <span className="text-muted-foreground">{expiration.label}</span>
            );

            return (
              <SettingsTableRow
                key={apiKey.id}
                className={cn(
                  expiration.isExpired &&
                    "bg-destructive/5 [tbody>&]:hover:bg-destructive/10",
                )}
              >
                <SettingsTableCell kind="primary">
                  <TruncatedText
                    text={apiKey.name || t("settings:apiKey.table.unnamedKey")}
                    className={cn(
                      "font-medium",
                      expiration.isExpired && "text-destructive-foreground",
                    )}
                  />
                  <span className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="sr-only">
                      {t("settings:apiKey.table.columnKey")}
                    </span>
                    <code className="truncate rounded border border-border bg-background px-1.5 py-0.5 text-xs">
                      {apiKey.start}...
                    </code>
                  </span>
                  <SettingsTableMeta hideAbove="md">
                    <span>
                      {t("settings:apiKey.table.columnCreated")}{" "}
                      {formatDate(apiKey.createdAt)}
                    </span>
                    <span>
                      {t("settings:apiKey.table.columnExpires")} {expires}
                    </span>
                  </SettingsTableMeta>
                </SettingsTableCell>
                <SettingsTableCell
                  label={t("accountSecurity:platform.apiKeys.columnScope")}
                >
                  <ScopeSummary scope={apiKey.scope} />
                </SettingsTableCell>
                <SettingsTableCell
                  hideBelow="md"
                  className="text-muted-foreground"
                >
                  {formatDate(apiKey.createdAt)}
                </SettingsTableCell>
                <SettingsTableCell hideBelow="md">{expires}</SettingsTableCell>
                <SettingsTableCell
                  label={t("settings:apiKey.table.columnLastUsed")}
                >
                  <LastUsed value={apiKey.lastRequest} />
                </SettingsTableCell>
                <SettingsTableCell kind="actions">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setRequestsKey(apiKey)}
                      aria-label={t(
                        "accountSecurity:platform.apiKeys.requestsAria",
                        {
                          name:
                            apiKey.name ||
                            t("settings:apiKey.table.deleteAriaFallback"),
                        },
                      )}
                    >
                      <Activity className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setPendingDeleteId(apiKey.id)}
                      disabled={deletingId === apiKey.id}
                      aria-label={t("settings:apiKey.table.deleteAria", {
                        name:
                          apiKey.name ||
                          t("settings:apiKey.table.deleteAriaFallback"),
                      })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </SettingsTableCell>
              </SettingsTableRow>
            );
          })}
        </SettingsTableBody>
      </SettingsTable>

      {requestsKey && (
        <ApiKeyRequestsSheet
          apiKey={requestsKey}
          onClose={() => setRequestsKey(null)}
        />
      )}

      <AlertDialog
        open={Boolean(pendingDeleteKey)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deletingId) {
            setPendingDeleteId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:apiKey.table.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:apiKey.table.deleteConfirmDescription", {
                name:
                  pendingDeleteKey?.name ||
                  t("settings:apiKey.table.deleteFallbackName"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={Boolean(deletingId)}
            >
              {deletingId
                ? t("settings:apiKey.table.deleting")
                : t("settings:apiKey.table.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
