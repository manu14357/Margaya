import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export type PageEmptyKind =
  | "none"
  | "public"
  | "private"
  | "archived"
  | "noMatch";

const COPY: Record<PageEmptyKind, { title: string; description?: string }> = {
  none: {
    title: "pages:list.empty.none.title",
    description: "pages:list.empty.none.description",
  },
  public: { title: "pages:list.empty.public.title" },
  private: {
    title: "pages:list.empty.private.title",
    description: "pages:list.empty.private.description",
  },
  archived: {
    title: "pages:list.empty.archived.title",
    description: "pages:list.empty.archived.description",
  },
  noMatch: {
    title: "pages:list.empty.noMatch.title",
    description: "pages:list.empty.noMatch.description",
  },
};

type PageEmptyStateProps = {
  kind: PageEmptyKind;
  /** "New page"; omitted without page:create and on the Archived tab. */
  onCreate?: () => void;
  isCreating?: boolean;
  onClearFilters?: () => void;
};

/** The Pages list's empty states (§1.3). */
export default function PageEmptyState({
  kind,
  onCreate,
  isCreating,
  onClearFilters,
}: PageEmptyStateProps) {
  const { t } = useTranslation();
  const copy = COPY[kind];
  const showCreate =
    Boolean(onCreate) && kind !== "archived" && kind !== "noMatch";

  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>{t(copy.title)}</EmptyTitle>
        {copy.description && (
          <EmptyDescription>{t(copy.description)}</EmptyDescription>
        )}
      </EmptyHeader>
      {(showCreate || (kind === "noMatch" && onClearFilters)) && (
        <EmptyContent>
          {showCreate && (
            <Button size="sm" loading={isCreating} onClick={onCreate}>
              <Plus className="size-3.5" />
              {t("pages:list.newPage")}
            </Button>
          )}
          {kind === "noMatch" && onClearFilters && (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              {t("pages:list.clearFilters")}
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
