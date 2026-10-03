import { Link2Off } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MargayaBranding } from "./margaya-branding";

/** A missing or unpublished board: the cause in plain words, then branding. */
export function ErrorView() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-[28%] bg-destructive/12">
            <Link2Off
              className="size-6 text-destructive-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-heading font-semibold text-2xl text-foreground">
              {t("publicProject:error.title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("publicProject:error.description")}
            </p>
          </div>
        </div>
      </main>
      <footer className="flex justify-center px-4 py-4 text-muted-foreground text-xs">
        <MargayaBranding />
      </footer>
    </div>
  );
}
