import { useTranslation } from "react-i18next";
import { LanguageMenu, ThemeMenu } from "../common/language-menu";
import { Logo } from "../common/logo";

type AuthLayoutProps = {
  children: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
};

/**
 * Two-column auth screen: a brand panel (sidebar tokens, the existing logo)
 * beside an unboxed form column. Under `lg` the panel shrinks to a header band.
 * The language and theme menus sit at the top of the form column.
 */
export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="grid h-svh w-full grid-rows-[auto_1fr] overflow-y-auto bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1">
      <aside className="relative flex flex-col justify-between gap-10 overflow-hidden border-b border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground sm:px-6 lg:sticky lg:top-0 lg:h-svh lg:border-r lg:border-b-0 lg:p-10 lg:pb-24">
        <div className="relative z-10 flex items-center">
          <Logo className="flex items-end" />
        </div>
        <div className="relative z-10 hidden max-w-sm space-y-3 lg:block">
          <p className="font-heading text-3xl font-semibold tracking-tight text-sidebar-accent-foreground text-balance">
            {t("auth:layout.headline")}
          </p>
          <p className="text-sm leading-relaxed">{t("auth:layout.lede")}</p>
        </div>
        <svg
          viewBox="0 0 400 160"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-40 w-full lg:block"
        >
          <path
            d="M0 136c60-24 120-28 200-8s140 16 200-16v48H0Z"
            className="fill-sidebar-accent"
          />
          <path
            d="M0 150c80-16 160-14 220 0s120 6 180-10v20H0Z"
            className="fill-sidebar-border"
          />
        </svg>
      </aside>

      <main className="flex min-w-0 flex-col items-center px-4 pt-3 pb-8 sm:px-6 lg:pt-4 lg:pb-12">
        <div className="flex w-full items-center justify-end gap-1">
          <LanguageMenu />
          <ThemeMenu />
        </div>
        <div className="mt-5 w-full max-w-sm space-y-6 sm:my-auto">
          <header className="space-y-1.5">
            <h1 className="text-2xl text-foreground">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </header>
          <div>{children}</div>
        </div>
      </main>
    </div>
  );
}
