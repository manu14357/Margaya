import { useTranslation } from "react-i18next";
import { Logo } from "@/components/common/logo";
import { cn } from "@/lib/cn";

type SetupLayoutProps = {
  children: React.ReactNode;
  /** 1-based step of a multi-step flow; draws the progress rail. */
  progress?: { current: number; total: number };
  width?: "sm" | "md";
};

/**
 * Full-screen frame for first-run setup (profile, invitations, onboarding):
 * a slim top bar with the logo and the step rail, then one centred column.
 */
export function SetupLayout({
  children,
  progress,
  width = "md",
}: SetupLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-svh w-full flex-col overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
        <Logo className="flex items-end" />
        {progress ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("auth:onboarding.progress", {
                current: progress.current,
                total: progress.total,
              })}
            </span>
            <span className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: progress.total }, (_, index) => {
                const step = index + 1;
                return (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length rail
                    key={index}
                    className={cn(
                      "h-1 rounded-full transition-all",
                      step < progress.current && "w-6 bg-primary",
                      step === progress.current && "w-10 bg-primary",
                      step > progress.current && "w-6 bg-border",
                    )}
                  />
                );
              })}
            </span>
          </div>
        ) : null}
      </header>
      <main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
        <div
          className={cn(
            "w-full sm:my-auto",
            width === "sm" ? "max-w-sm" : "max-w-lg",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/** Heading block shared by the setup steps. */
export function SetupHeading({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl text-foreground">{title}</h1>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
