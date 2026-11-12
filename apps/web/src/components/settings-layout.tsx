import { Eye } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

/*
 * Settings page building blocks. The settings route (routes/.../settings.tsx)
 * owns the top bar, the section navigation (in the context panel) and the
 * scrolling canvas; a page renders one <SettingsPage> with sections of rows:
 *
 *   <SettingsPage title=… description=… actions={<Button>…</Button>}>
 *     <SettingsSection title=… description=…>
 *       <SettingsGroup>
 *         <SettingsRow label=… description=… htmlFor=…>{control}</SettingsRow>
 *       </SettingsGroup>
 *     </SettingsSection>
 *     <SettingsDangerZone title=… description=…>…rows…</SettingsDangerZone>
 *   </SettingsPage>
 *
 * Saving: a switch or a menu saves at once (with a toast); a group of text
 * fields or several choices that belong together ends in <SettingsSaveFooter>,
 * whose Save button wakes up only when something changed.
 */

type SettingsPageProps = {
  title: ReactNode;
  description?: ReactNode;
  /** The browser tab title; defaults to `title` when that is a string. */
  documentTitle?: string;
  /** Right of the heading: the page's one primary action. */
  actions?: ReactNode;
  /** Above the heading, e.g. a link back to the parent list. */
  eyebrow?: ReactNode;
  /** Shown above the sections (e.g. a read-only notice). */
  notice?: ReactNode;
  /** Tables and editors can use "wide". */
  width?: "narrow" | "wide";
  children?: ReactNode;
  className?: string;
};

export function SettingsPage({
  title,
  description,
  documentTitle,
  actions,
  eyebrow,
  notice,
  width = "narrow",
  children,
  className,
}: SettingsPageProps) {
  const tabTitle =
    documentTitle ?? (typeof title === "string" ? title : undefined);
  return (
    <>
      {tabTitle && <PageTitle title={tabTitle} />}
      <div
        className={cn(
          "mx-auto w-full px-4 pt-4 pb-12 md:px-6 md:pt-6",
          width === "wide" ? "max-w-6xl" : "max-w-3xl",
        )}
        data-slot="settings-page"
      >
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <PageHeader title={title} description={description} actions={actions} />
        <div className={cn("flex flex-col gap-8", className)}>
          {notice}
          {children}
        </div>
      </div>
    </>
  );
}

type SettingsSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Right of the section heading: secondary actions only. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A titled group of settings. */
export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2
            id={headingId}
            className="font-semibold text-foreground text-sm leading-5"
          >
            {title}
          </h2>
          {description && (
            <p className="text-[13px] text-muted-foreground leading-5">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** A bordered list of rows, divided by hairlines. */
export function SettingsGroup({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col divide-y rounded-lg border bg-card",
        tone === "danger"
          ? "divide-destructive/15 border-destructive/30"
          : "divide-border",
        className,
      )}
      data-slot="settings-group"
    >
      {children}
    </div>
  );
}

type SettingsRowProps = {
  /** A string renders as a <Label>; pass a node (e.g. <FormLabel>) to own it. */
  label: ReactNode;
  description?: ReactNode;
  /** Associates a string label with its control. */
  htmlFor?: string;
  /** Next to the label: a source badge, a status chip. */
  badge?: ReactNode;
  /** Under the description: a warning or consequence. */
  note?: ReactNode;
  /** Label above, control full width below (textareas, lists). */
  stacked?: boolean;
  children?: ReactNode;
  className?: string;
};

/** One setting: what it is on the left, its control on the right. */
export function SettingsRow({
  label,
  description,
  htmlFor,
  badge,
  note,
  stacked = false,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 px-4 py-3",
        !stacked &&
          "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-6",
        // A switch stays beside its label on narrow screens too.
        !stacked &&
          "has-[>[data-slot=settings-row-control]>[data-slot=switch]]:grid-cols-[minmax(0,1fr)_auto] has-[>[data-slot=settings-row-control]>[data-slot=switch]]:items-center has-[>[data-slot=settings-row-control]>[data-slot=switch]]:gap-x-4",
        className,
      )}
      data-slot="settings-row"
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {typeof label === "string" ? (
            <Label htmlFor={htmlFor} className="font-medium text-sm">
              {label}
            </Label>
          ) : (
            label
          )}
          {badge}
        </div>
        {description && (
          <p className="text-muted-foreground text-xs leading-4.5">
            {description}
          </p>
        )}
        {note && (
          <p className="text-warning-foreground text-xs leading-4.5">{note}</p>
        )}
      </div>
      {children !== undefined && (
        <div
          data-slot="settings-row-control"
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-2",
            !stacked && "sm:justify-end",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Irreversible actions, last on the page, in a destructive frame. */
export function SettingsDangerZone({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} description={description}>
      <SettingsGroup tone="danger">{children}</SettingsGroup>
    </SettingsSection>
  );
}

/** A quiet line of text inside a group (loading, empty, no access). */
export function SettingsGroupMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={cn(
        "px-4 py-6 text-xs",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

/**
 * The end of a group that saves together: "Unsaved changes" while it differs
 * from what is saved, and a Save button that is enabled only then.
 */
export function SettingsSaveFooter({
  dirty,
  saving = false,
  disabled = false,
  saveLabel,
  onSave,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  /** Something is invalid: Save stays off even with changes. */
  disabled?: boolean;
  saveLabel?: ReactNode;
  onSave: () => void | Promise<void>;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t px-4 py-2.5",
        className,
      )}
      data-slot="settings-save-footer"
    >
      {dirty && (
        <span
          className="me-auto text-muted-foreground text-xs"
          role="status"
          aria-live="polite"
        >
          {t("settings:unsavedChanges")}
        </span>
      )}
      <Button
        size="sm"
        type="button"
        loading={saving}
        disabled={!dirty || disabled || saving}
        onClick={() => void onSave()}
      >
        {saveLabel ?? t("settings:save")}
      </Button>
    </div>
  );
}

/** Says why the controls below are read-only for this person. */
export function SettingsReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <Alert variant="info">
      <Eye />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** An empty list inside a section: a muted icon, one sentence, one action. */
export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card/60 px-4 py-8 text-center"
      data-slot="settings-empty"
    >
      {icon && (
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4.5">
          {icon}
        </div>
      )}
      <p className="font-medium text-sm">{title}</p>
      {description && (
        <p className="max-w-sm text-muted-foreground text-xs leading-4.5">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
