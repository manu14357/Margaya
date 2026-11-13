import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { InstanceSection } from "@/components/instance-admin/instance-page";
import { SearchField } from "@/components/instance-admin/search-field";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type {
  AdminFeedback,
  AdminFeedbackFilters,
} from "@/fetchers/feedback/admin-feedback";
import {
  useDeleteAdminFeedback,
  useExportAdminFeedback,
  usePurgeAdminFeedback,
} from "@/hooks/mutations/feedback/use-feedback-mutations";
import { useAdminFeedbackList } from "@/hooks/queries/feedback/use-feedback";
import {
  type FeedbackFormat,
  type FeedbackPageType,
  PAGE_TYPE_KEYS,
  scaleOptions,
} from "@/lib/feedback";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import {
  FEATURE_KEYS,
  type FeedbackKind,
  FORMAT_KEYS,
  KIND_KEYS,
} from "./feedback-labels";

const ALL = "all";
const PURGE_CHOICES = [365, 180, 90, 0] as const;

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The answers, newest first, with filters, CSV export and deletion. */
export function FeedbackResponsesSection() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<FeedbackKind | undefined>();
  const [format, setFormat] = useState<FeedbackFormat | undefined>();
  const [commentsOnly, setCommentsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState<number>(365);
  const filters: AdminFeedbackFilters = {
    kind,
    format,
    hasComment: commentsOnly ? true : undefined,
    search: search || undefined,
  };
  const list = useAdminFeedbackList(filters);
  const exportCsv = useExportAdminFeedback();
  const purge = usePurgeAdminFeedback();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const runExport = async () => {
    try {
      await exportCsv.mutateAsync(filters);
    } catch (error) {
      toast.error(errorText(error, t("settings:feedback.admin.exportError")));
    }
  };

  const runPurge = async () => {
    try {
      const result = await purge.mutateAsync(purgeDays);
      toast.success(
        t("settings:feedback.admin.purged", { count: result.deleted }),
      );
    } catch (error) {
      toast.error(errorText(error, t("settings:feedback.admin.deleteError")));
    }
  };

  return (
    <InstanceSection
      title={t("settings:feedback.admin.responsesTitle")}
      boxed={false}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={exportCsv.isPending}
            onClick={() => void runExport()}
          >
            <Download aria-hidden />
            {t("settings:feedback.admin.exportCsv")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPurgeOpen(true)}
          >
            <Trash2 aria-hidden />
            {t("settings:feedback.admin.purge")}
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={kind ?? ALL}
          onValueChange={(value) =>
            setKind(value === ALL ? undefined : (value as FeedbackKind))
          }
        >
          <SelectTrigger
            className="w-40"
            aria-label={t("settings:feedback.admin.source")}
          >
            <SelectValue>
              {kind
                ? t(KIND_KEYS[kind])
                : t("settings:feedback.admin.allSources")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t("settings:feedback.admin.allSources")}
            </SelectItem>
            {(Object.keys(KIND_KEYS) as FeedbackKind[]).map((option) => (
              <SelectItem key={option} value={option}>
                {t(KIND_KEYS[option])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={format ?? ALL}
          onValueChange={(value) =>
            setFormat(value === ALL ? undefined : (value as FeedbackFormat))
          }
        >
          <SelectTrigger
            className="w-44"
            aria-label={t("settings:feedback.admin.scale")}
          >
            <SelectValue>
              {format
                ? t(FORMAT_KEYS[format])
                : t("settings:feedback.admin.allScales")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t("settings:feedback.admin.allScales")}
            </SelectItem>
            {(Object.keys(FORMAT_KEYS) as FeedbackFormat[]).map((option) => (
              <SelectItem key={option} value={option}>
                {t(FORMAT_KEYS[option])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="feedback-comments-only"
            checked={commentsOnly}
            onCheckedChange={setCommentsOnly}
          />
          <Label htmlFor="feedback-comments-only" className="text-sm">
            {t("settings:feedback.admin.commentsOnly")}
          </Label>
        </div>
        <div className="ml-auto">
          <SearchField
            value={search}
            placeholder={t("settings:feedback.admin.search")}
            onChange={(next) => setSearch(next.trim())}
          />
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-16 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{t("settings:feedback.admin.loadError")}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void list.refetch()}
          >
            {t("settings:feedback.admin.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("settings:feedback.admin.responsesEmpty")}
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {items.map((item) => (
              <FeedbackRow key={item.id} item={item} />
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t("settings:feedback.admin.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:feedback.admin.purgeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:feedback.admin.purgeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6">
            <Select
              value={String(purgeDays)}
              onValueChange={(value) => setPurgeDays(Number(value))}
            >
              <SelectTrigger
                aria-label={t("settings:feedback.admin.purgeWhich")}
              >
                <SelectValue>
                  {purgeDays === 0
                    ? t("settings:feedback.admin.purgeAll")
                    : t("settings:feedback.admin.purgeOlder", {
                        count: purgeDays,
                      })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PURGE_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={String(choice)}>
                    {choice === 0
                      ? t("settings:feedback.admin.purgeAll")
                      : t("settings:feedback.admin.purgeOlder", {
                          count: choice,
                        })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("settings:feedback.admin.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void runPurge()}
                />
              }
            >
              {t("settings:feedback.admin.purgeConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </InstanceSection>
  );
}

function scoreLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  item: AdminFeedback,
) {
  if (item.score === null) return t("settings:feedback.admin.commentOnly");
  const option = scaleOptions(item.format).find(
    (candidate) => candidate.score === item.score,
  );
  return option
    ? t(option.labelKey, { count: item.score })
    : String(item.score);
}

function FeedbackRow({ item }: { item: AdminFeedback }) {
  const { t } = useTranslation();
  const remove = useDeleteAdminFeedback();
  const meta = [
    item.feature && FEATURE_KEYS[item.feature]
      ? t(FEATURE_KEYS[item.feature] as string)
      : null,
    item.pageType
      ? t(
          PAGE_TYPE_KEYS[item.pageType as FeedbackPageType] ??
            PAGE_TYPE_KEYS.other,
        )
      : null,
    item.appVersion ? `v${item.appVersion}` : null,
    item.client === "desktop" ? t("settings:feedback.admin.desktop") : null,
    formatDateTime(item.createdAt),
  ].filter(Boolean);

  const runDelete = async () => {
    try {
      await remove.mutateAsync(item.id);
    } catch (error) {
      toast.error(errorText(error, t("settings:feedback.admin.deleteError")));
    }
  };

  return (
    <li className="flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">{scoreLabel(t, item)}</span>
          <span className="text-xs text-muted-foreground">
            {t(KIND_KEYS[item.kind])} · {t(FORMAT_KEYS[item.format])}
          </span>
        </div>
        {item.comment && (
          <p className="whitespace-pre-wrap break-words text-sm">
            {item.comment}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {item.user.name || item.user.email}
          {item.user.name ? ` · ${item.user.email}` : ""} · {meta.join(" · ")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("settings:feedback.admin.delete")}
        disabled={remove.isPending}
        onClick={() => void runDelete()}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}
