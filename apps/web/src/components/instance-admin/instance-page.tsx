import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage, SettingsSection } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LockedCallout } from "./locked-callout";

type InstancePageProps = {
  title: string;
  subtitle: string;
  /** The global lock: every control on the page is read-only. */
  locked?: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

/** The frame of every Instance settings page, like the workspace pages. */
export function InstancePage({
  title,
  subtitle,
  locked = false,
  actions,
  children,
}: InstancePageProps) {
  const { t } = useTranslation();
  return (
    <SettingsPage
      title={title}
      documentTitle={t("instanceAdmin:pageTitle", { page: title })}
      description={subtitle}
      actions={actions}
      notice={
        locked ? (
          <LockedCallout>{t("instanceAdmin:lockedCallout")}</LockedCallout>
        ) : undefined
      }
    >
      {children}
    </SettingsPage>
  );
}

type InstanceSectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Wrap the content in the bordered settings box. */
  boxed?: boolean;
  className?: string;
  children: ReactNode;
};

export function InstanceSection({
  title,
  description,
  actions,
  boxed = true,
  className,
  children,
}: InstanceSectionProps) {
  return (
    <SettingsSection
      title={title}
      description={description}
      actions={actions}
      className={className}
    >
      {boxed ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          {children}
        </div>
      ) : (
        children
      )}
    </SettingsSection>
  );
}

type LoadStateProps = {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  rows?: number;
};

/** Skeleton rows while loading, an inline error with Retry on failure. */
export function InstanceLoadState({
  isLoading,
  isError,
  onRetry,
  rows = 3,
}: LoadStateProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{t("instanceAdmin:loadError")}</span>
        <Button variant="outline" size="xs" onClick={onRetry}>
          {t("instanceAdmin:retry")}
        </Button>
      </div>
    );
  }
  return null;
}
