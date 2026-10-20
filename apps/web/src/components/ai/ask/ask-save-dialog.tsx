import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { toast } from "@/lib/toast";

const MAX_PAGE_TITLE = 200;

/**
 * Saves an answer or a whole conversation as a page: the title and the
 * project (the scoped one first) can be changed before saving.
 */
export function AskSaveDialog({
  workspaceId,
  projects,
  defaultProjectId,
  title: initialTitle,
  content,
  onClose,
}: {
  workspaceId: string;
  projects: readonly { id: string; name: string }[];
  defaultProjectId: string | null;
  title: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createPage = useCreatePage();
  const [title, setTitle] = useState(initialTitle.slice(0, MAX_PAGE_TITLE));
  const [projectId, setProjectId] = useState<string>(
    defaultProjectId ?? projects[0]?.id ?? "",
  );
  const project = projects.find((item) => item.id === projectId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!projectId || !title.trim()) return;
    createPage.mutate(
      { projectId, title: title.trim(), content },
      {
        onSuccess: (page) => {
          onClose();
          toast.success(t("ai:ask.save.saved"), {
            action: {
              label: t("ai:ask.save.open"),
              onClick: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, projectId, pageId: page.id },
                }),
            },
          });
        },
        onError: () => toast.error(t("ai:ask.save.error")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>{t("ai:ask.save.title")}</DialogTitle>
            <DialogDescription>
              {t("ai:ask.save.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ask-save-title">
                {t("ai:ask.save.pageTitle")}
              </Label>
              <Input
                id="ask-save-title"
                value={title}
                maxLength={MAX_PAGE_TITLE}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ask-save-project">
                {t("ai:ask.save.project")}
              </Label>
              {projects.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("ai:ask.save.noProjects")}
                </p>
              ) : (
                <Select
                  value={projectId}
                  onValueChange={(value) => value && setProjectId(value)}
                >
                  <SelectTrigger id="ask-save-project">
                    <SelectValue>{project?.name ?? ""}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 border-t px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              loading={createPage.isPending}
              disabled={!projectId || !title.trim()}
            >
              {t("ai:ask.save.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
