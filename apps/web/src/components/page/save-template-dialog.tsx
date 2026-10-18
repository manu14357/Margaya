import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSavePageTemplate } from "@/hooks/mutations/page/use-page-template-mutations";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";

type Scope = "project" | "workspace";

type SaveTemplateDialogProps = {
  pageId: string;
  pageTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Saves the page's current content as a template. */
export default function SaveTemplateDialog({
  pageId,
  pageTitle,
  open,
  onOpenChange,
}: SaveTemplateDialogProps) {
  const { t } = useTranslation();
  const save = useSavePageTemplate();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("project");

  useEffect(() => {
    if (!open) return;
    setName(pageTitle);
    setScope("project");
  }, [open, pageTitle]);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    save.mutate(
      { pageId, name: trimmed, scope },
      {
        onSuccess: () => {
          toast.success(t("pages:templates.savedToast"));
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(
            pageErrorMessage(error) ?? t("pages:templates.saveError"),
          ),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !save.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pages:templates.saveTitle")}</DialogTitle>
            <DialogDescription>
              {t("pages:templates.saveDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="page-template-name">
                {t("pages:templates.nameLabel")}
              </Label>
              <Input
                id="page-template-name"
                autoFocus
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1.5 font-medium text-sm">
                {t("pages:templates.scopeLabel")}
              </legend>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as Scope)}
                className="gap-2"
              >
                {(["project", "workspace"] as const).map((value) => (
                  <Label
                    key={value}
                    className="flex items-start gap-2 font-normal"
                  >
                    <RadioGroupItem value={value} className="mt-0.5" />
                    <span>
                      <span className="block text-sm">
                        {value === "project"
                          ? t("pages:templates.scopeProject")
                          : t("pages:templates.scopeWorkspace")}
                      </span>
                      <span className="block text-muted-foreground text-xs">
                        {value === "project"
                          ? t("pages:templates.scopeProjectHint")
                          : t("pages:templates.scopeWorkspaceHint")}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed} loading={save.isPending}>
              {t("pages:templates.saveConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
