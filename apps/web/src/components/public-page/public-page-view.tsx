import { Link2Off } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import PageLogo from "@/components/page/page-logo";
import PageTitle from "@/components/page-title";
import { MargayaBranding } from "@/components/public-project/margaya-branding";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicPage } from "@/hooks/queries/public-page/use-public-page";
import { formatDateMedium } from "@/lib/format";
import PublicPageContent from "./public-page-content";
import "@/components/page/page-editor/page-editor.css";

/** Keeps search engines away from the public copy (the API says so too). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Unavailable() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-24">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Link2Off className="size-6 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1.5">
          <h1 className="font-heading font-semibold text-2xl">
            {t("pages:publicView.unavailableTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("pages:publicView.unavailableDescription")}
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * A published page without app chrome: the title and the read-only body at
 * reading width, then a quiet footer.
 */
export default function PublicPageView({ token }: { token: string }) {
  const { t } = useTranslation();
  const page = usePublicPage(token);
  useNoIndex();

  const title = page.data?.title.trim() || t("pages:list.untitled");

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background text-foreground">
      <PageTitle
        title={page.data ? title : t("pages:publicView.documentTitle")}
        hideAppName={false}
      />
      {page.isLoading ? (
        <main className="margaya-page-main flex-1">
          <div className="margaya-page-column space-y-3 py-16">
            <Skeleton className="h-9 w-3/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </main>
      ) : page.isError || !page.data ? (
        <Unavailable />
      ) : (
        <main
          className="margaya-page-main flex-1"
          data-full-width={page.data.isFullWidth ? "true" : "false"}
        >
          <article className="margaya-page-column pt-16 pb-24">
            <header className="mb-6 space-y-3">
              {page.data.logoKind && (
                <PageLogo
                  logoKind={page.data.logoKind}
                  logoValue={page.data.logoValue}
                  className="size-10 text-[2.25rem]"
                />
              )}
              <h1 className="font-bold text-[2rem] leading-[2.375rem] tracking-[-0.02em]">
                {title}
              </h1>
              <p className="text-muted-foreground text-xs tabular-nums">
                {t("pages:publicView.updated", {
                  date: formatDateMedium(page.data.updatedAt),
                })}
              </p>
            </header>
            <PublicPageContent content={page.data.content} />
          </article>
        </main>
      )}
      <footer className="flex justify-center px-4 py-6 text-muted-foreground text-xs">
        <MargayaBranding />
      </footer>
    </div>
  );
}
