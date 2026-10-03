import { Link } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetPageBacklinks } from "@/hooks/queries/page/use-get-page-backlinks";
import {
  formatDateMedium,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/format";
import { textBlocksFromDoc } from "@/lib/pages/editor-document";
import { computePageStats } from "@/lib/pages/page-stats";
import type { Page } from "@/types/page";
import MemberAvatar from "./member-avatar";
import PageLogo from "./page-logo";
import { useEditorRevision } from "./use-editor-revision";
import type { PageMember } from "./use-page-members";

type PageInfoProps = {
  page: Page;
  workspaceId: string;
  editor: Editor | null;
  getMember: (userId: string | null | undefined) => PageMember | null;
};

function PersonRow({
  label,
  person,
  detail,
  detailTitle,
}: {
  label: string;
  person: PageMember | null;
  detail: string;
  detailTitle?: string;
}) {
  const { t } = useTranslation();
  const name = person?.name ?? t("pages:history.unknownUser");
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="flex items-center gap-2 text-sm">
        <MemberAvatar name={name} image={person?.image} />
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground">·</span>
        <span
          className="shrink-0 text-muted-foreground text-xs"
          title={detailTitle}
        >
          {detail}
        </span>
      </div>
    </div>
  );
}

/** Live statistics, who created and edited the page, and its backlinks. */
export default function PageInfo({
  page,
  workspaceId,
  editor,
  getMember,
}: PageInfoProps) {
  const { t } = useTranslation();
  const revision = useEditorRevision(editor);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision tracks document changes
  const stats = useMemo(
    () =>
      computePageStats(
        editor && !editor.isDestroyed
          ? textBlocksFromDoc(editor.state.doc)
          : page.contentMarkdown.split("\n"),
      ),
    [editor, page.contentMarkdown, revision],
  );
  const backlinks = useGetPageBacklinks(page.id, true);
  const untitled = t("pages:list.untitled");

  const cells = [
    { label: t("pages:info.words"), value: stats.words.toLocaleString() },
    {
      label: t("pages:info.characters"),
      value: stats.characters.toLocaleString(),
    },
    {
      label: t("pages:info.paragraphs"),
      value: stats.paragraphs.toLocaleString(),
    },
    {
      label: t("pages:info.readingTime"),
      value: stats.underAMinute
        ? t("pages:info.lessThanMinute")
        : t("pages:info.readingMinutes", { count: stats.readingMinutes }),
    },
  ];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="rounded-md border border-border/70 bg-card/60 px-2.5 py-1.5"
          >
            <dt className="text-muted-foreground text-xs">{cell.label}</dt>
            <dd className="font-semibold text-base tabular-nums">
              {cell.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-3">
        <PersonRow
          label={t("pages:info.createdBy")}
          person={getMember(page.ownerId ?? page.createdById)}
          detail={formatDateMedium(page.createdAt)}
          detailTitle={formatDateTime(page.createdAt)}
        />
        <PersonRow
          label={t("pages:info.lastEditedBy")}
          person={getMember(page.updatedById ?? page.createdById)}
          detail={formatRelativeTime(page.updatedAt)}
          detailTitle={formatDateTime(page.updatedAt)}
        />
        {page.isLocked && page.lockedAt && (
          <PersonRow
            label={t("pages:info.lockedBy")}
            person={getMember(page.lockedById)}
            detail={formatDateMedium(page.lockedAt)}
            detailTitle={formatDateTime(page.lockedAt)}
          />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {t("pages:info.linkedFrom")}
        </p>
        {backlinks.isLoading ? (
          <Skeleton className="h-7 w-full" />
        ) : (backlinks.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("pages:info.noBacklinks")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {(backlinks.data ?? []).map((source) => (
              <li key={source.id}>
                <Link
                  to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
                  params={{
                    workspaceId,
                    projectId: source.projectId ?? "",
                    pageId: source.id,
                  }}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent"
                >
                  <PageLogo
                    logoKind={source.logoKind}
                    logoValue={source.logoValue}
                  />
                  <span className="truncate">
                    {source.title.trim() || untitled}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
