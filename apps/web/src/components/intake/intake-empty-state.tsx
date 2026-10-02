import {
  Archive,
  CircleCheck,
  FileQuestionMark,
  Inbox,
  type LucideIcon,
  MousePointerClick,
  Plus,
  SearchX,
} from "lucide-react";
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
import type { IntakeEmptyKind } from "@/lib/intake-search";

export type IntakeEmptyVariant = IntakeEmptyKind | "selectPrompt" | "notFound";

const VARIANTS: Record<IntakeEmptyVariant, LucideIcon> = {
  noRequests: Inbox,
  caughtUp: CircleCheck,
  noClosed: Archive,
  noMatches: SearchX,
  mine: Inbox,
  selectPrompt: MousePointerClick,
  notFound: FileQuestionMark,
};

type IntakeEmptyStateProps = {
  variant: IntakeEmptyVariant;
  /** "New request", offered by noRequests and mine. */
  onCreate?: () => void;
  onClearFilters?: () => void;
  onBack?: () => void;
  className?: string;
};

/** Every empty state of the Intake screen (B7 §1.3). */
export default function IntakeEmptyState({
  variant,
  onCreate,
  onClearFilters,
  onBack,
  className,
}: IntakeEmptyStateProps) {
  const { t } = useTranslation();
  const Icon = VARIANTS[variant];
  const showCreate =
    Boolean(onCreate) && (variant === "noRequests" || variant === "mine");
  const showClear = Boolean(onClearFilters) && variant === "noMatches";
  const showBack = Boolean(onBack) && variant === "notFound";

  return (
    <Empty className={className ?? "py-16"}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{t(`intake:empty.${variant}.title`)}</EmptyTitle>
        <EmptyDescription>
          {t(`intake:empty.${variant}.description`)}
        </EmptyDescription>
      </EmptyHeader>
      {(showCreate || showClear || showBack) && (
        <EmptyContent>
          {showCreate && (
            <Button size="sm" onClick={onCreate}>
              <Plus />
              {t("intake:newRequest")}
            </Button>
          )}
          {showClear && (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              {t("intake:filters.clear")}
            </Button>
          )}
          {showBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              {t("intake:empty.backToIntake")}
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
