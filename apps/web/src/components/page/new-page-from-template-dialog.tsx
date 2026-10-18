import { LayoutTemplate, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeletePageTemplate } from "@/hooks/mutations/page/use-page-template-mutations";
import { usePageTemplates } from "@/hooks/queries/page/use-page-templates";
import { builtinTemplates } from "@/lib/pages/builtin-templates";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import PageLogo from "./page-logo";

export type TemplateChoice =
  | { kind: "builtin"; title: string; content: string }
  | { kind: "saved"; templateId: string };

type NewPageFromTemplateDialogProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Creates the page from the choice (the dialog stays open meanwhile). */
  onChoose: (choice: TemplateChoice) => void;
  isCreating: boolean;
};

const ROW =
  "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60";

/** Picks a starter or saved template for a new page. */
export default function NewPageFromTemplateDialog({
  projectId,
  open,
  onOpenChange,
  onChoose,
  isCreating,
}: NewPageFromTemplateDialogProps) {
  const { t } = useTranslation();
  const builtins = useMemo(() => builtinTemplates(t), [t]);
  const saved = usePageTemplates(projectId, open);
  const remove = useDeletePageTemplate();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isCreating && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pages:templates.pickTitle")}</DialogTitle>
          <DialogDescription>
            {t("pages:templates.pickDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 pb-6">
          <section
            aria-labelledby="page-templates-starters"
            className="space-y-1"
          >
            <h3
              id="page-templates-starters"
              className="px-2 font-medium text-muted-foreground text-xs"
            >
              {t("pages:templates.starters")}
            </h3>
            {builtins.map((template) => (
              <button
                key={template.id}
                type="button"
                className={ROW}
                disabled={isCreating}
                onClick={() =>
                  onChoose({
                    kind: "builtin",
                    title: template.name,
                    content: template.markdown,
                  })
                }
              >
                <template.icon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-sm">
                    {template.name}
                  </span>
                  <span className="block text-muted-foreground text-xs">
                    {template.description}
                  </span>
                </span>
              </button>
            ))}
          </section>

          <section aria-labelledby="page-templates-saved" className="space-y-1">
            <h3
              id="page-templates-saved"
              className="px-2 font-medium text-muted-foreground text-xs"
            >
              {t("pages:templates.saved")}
            </h3>
            {saved.isLoading ? (
              <div className="space-y-2 px-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : saved.isError ? (
              <p className="px-2 text-muted-foreground text-sm">
                {t("pages:templates.loadError")}
              </p>
            ) : (saved.data ?? []).length === 0 ? (
              <p className="px-2 text-muted-foreground text-sm">
                {t("pages:templates.savedEmpty")}
              </p>
            ) : (
              (saved.data ?? []).map((template) => (
                <div
                  key={template.id}
                  className="group flex items-center gap-1"
                >
                  <button
                    type="button"
                    className={ROW}
                    disabled={isCreating}
                    onClick={() =>
                      onChoose({ kind: "saved", templateId: template.id })
                    }
                  >
                    {template.logoKind ? (
                      <PageLogo
                        logoKind={template.logoKind}
                        logoValue={template.logoValue}
                        className="mt-0.5"
                      />
                    ) : (
                      <LayoutTemplate
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sm">
                        {template.name}
                      </span>
                      <span className="block text-muted-foreground text-xs">
                        {template.scope === "workspace"
                          ? t("pages:templates.scopeWorkspace")
                          : t("pages:templates.scopeProject")}
                      </span>
                    </span>
                  </button>
                  {template.canDelete && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground"
                      aria-label={t("pages:templates.deleteLabel", {
                        name: template.name,
                      })}
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(template.id, {
                          onSuccess: () =>
                            toast.success(t("pages:templates.deleted")),
                          onError: (error) =>
                            toast.error(
                              pageErrorMessage(error) ??
                                t("pages:templates.deleteError"),
                            ),
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
