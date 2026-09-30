import { Copy, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteModuleLink } from "@/hooks/mutations/module/use-module-link-mutations";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { getExternalWebUrl } from "@/lib/external-url";
import { toast } from "@/lib/toast";
import type { ModuleDetail, ModuleLink } from "@/types/module";
import ModuleLinkDialog from "./module-link-dialog";

function linkLabel(link: ModuleLink): string {
  if (link.title) return link.title;
  try {
    return new URL(link.url).host;
  } catch {
    return link.url;
  }
}

type ModuleLinksSectionProps = {
  module: Pick<ModuleDetail, "id" | "projectId" | "links">;
  canEdit: boolean;
};

/** The module's reference links, with add, edit, copy and delete. */
export default function ModuleLinksSection({
  module,
  canEdit,
}: ModuleLinksSectionProps) {
  const { t } = useTranslation();
  const deleteLink = useDeleteModuleLink();
  const [editing, setEditing] = useState<ModuleLink | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModuleLink | null>(null);

  const handleCopy = async (link: ModuleLink) => {
    if (await copyToClipboard(link.url)) {
      toast.success(t("modules:toast.linkCopied"));
    }
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteLink.mutate(
      {
        moduleId: module.id,
        linkId: deleting.id,
        projectId: module.projectId,
      },
      {
        onSuccess: () => {
          toast.success(t("modules:toast.linkDeleted"));
          setDeleting(null);
        },
        onError: (error) =>
          toast.error(error.message || t("modules:toast.linkError")),
      },
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-muted-foreground text-xs">
          {t("modules:sidebar.links")}
        </h3>
        {canEdit && (
          <Button
            variant="ghost"
            size="xs"
            className="gap-1"
            onClick={() => setEditing("new")}
          >
            <Plus className="size-3" />
            {t("modules:links.add")}
          </Button>
        )}
      </div>

      {module.links.length === 0 ? (
        <p className="px-2 text-muted-foreground text-xs">
          {t("modules:links.empty")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {module.links.map((link) => {
            const href = getExternalWebUrl(link.url);
            const label = linkLabel(link);
            return (
              <li
                key={link.id}
                className="group/link relative flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
              >
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("modules:links.open", { title: label })}
                      className="block truncate text-sm outline-none after:absolute after:inset-0 focus-visible:underline"
                    >
                      {label}
                    </a>
                  ) : (
                    <span className="block truncate text-sm">{label}</span>
                  )}
                  <span className="block truncate text-muted-foreground text-xs">
                    {link.url}
                  </span>
                </span>
                <span className="relative z-10 flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/link:opacity-100 pointer-coarse:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("modules:links.copy")}
                    title={t("modules:links.copy")}
                    onClick={() => void handleCopy(link)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("modules:links.edit")}
                        title={t("modules:links.edit")}
                        onClick={() => setEditing(link)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("modules:links.delete")}
                        title={t("modules:links.delete")}
                        onClick={() => setDeleting(link)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <ModuleLinkDialog
          module={module}
          link={editing === "new" ? null : editing}
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteLink.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("modules:links.deleteConfirm")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("modules:links.deleteDescription", {
                title: deleting ? linkLabel(deleting) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={deleteLink.isPending}
              onClick={() => setDeleting(null)}
            >
              {t("modules:links.cancel")}
            </Button>
            <Button
              variant="destructive"
              loading={deleteLink.isPending}
              onClick={handleDelete}
            >
              {t("modules:links.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
