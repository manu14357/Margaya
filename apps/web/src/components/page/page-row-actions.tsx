import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  FilePlus,
  FolderInput,
  Globe,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { type ComponentType, Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Button } from "@/components/ui/button";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type { PageSummary } from "@/types/page";
import type { PageActions } from "./use-page-actions";

type ItemProps = {
  onClick?: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  children: ReactNode;
};

const COMPONENTS = {
  dropdown: {
    Item: DropdownMenuItem as ComponentType<ItemProps>,
    Separator: DropdownMenuSeparator as ComponentType,
  },
  context: {
    Item: ContextMenuItem as ComponentType<ItemProps>,
    Separator: ContextMenuSeparator as ComponentType,
  },
};

export type PageMenuItemId =
  | "openInNewTab"
  | "copyLink"
  | "newSubpage"
  | "duplicate"
  | "lock"
  | "access"
  | "move"
  | "archive"
  | "delete";

/** The row menu's items for a page, gated by its capabilities (§1.3). */
export function pageMenuItemIds(
  page: Pick<PageSummary, "capabilities" | "archivedAt">,
  { withNewSubpage = false }: { withNewSubpage?: boolean } = {},
): PageMenuItemId[] {
  const { capabilities } = page;
  const ids: PageMenuItemId[] = ["openInNewTab", "copyLink"];
  if (withNewSubpage && capabilities.canCreateSubpage) ids.push("newSubpage");
  if (capabilities.canDuplicate) ids.push("duplicate");
  if (capabilities.canLock) ids.push("lock");
  if (capabilities.canChangeAccess) ids.push("access");
  if (capabilities.canMove) ids.push("move");
  if (capabilities.canArchive) ids.push("archive");
  if (capabilities.canDelete && page.archivedAt) ids.push("delete");
  return ids;
}

type PageMenuItemsProps = {
  page: PageSummary;
  actions: PageActions;
  kind: "dropdown" | "context";
  withNewSubpage?: boolean;
};

/** The same items as dropdown or context menu entries. */
export function PageMenuItems({
  page,
  actions,
  kind,
  withNewSubpage,
}: PageMenuItemsProps) {
  const { t } = useTranslation();
  const { Item, Separator } = COMPONENTS[kind];
  const ids = pageMenuItemIds(page, { withNewSubpage });
  const isPrivate = page.access === "private";

  return ids.map((id) => {
    switch (id) {
      case "openInNewTab":
        return (
          <Item key={id} onClick={actions.openInNewTab}>
            <ExternalLink />
            {t("pages:actions.openInNewTab")}
          </Item>
        );
      case "copyLink":
        return (
          <Item key={id} onClick={() => void actions.copyLink()}>
            <Link2 />
            {t("pages:actions.copyLink")}
          </Item>
        );
      case "newSubpage":
        return (
          <Item
            key={id}
            onClick={actions.newSubpage}
            disabled={actions.isCreatingSubpage}
          >
            <FilePlus />
            {t("pages:actions.newSubpage")}
          </Item>
        );
      case "duplicate":
        return (
          <Item key={id} onClick={actions.duplicate}>
            <Copy />
            {t("pages:actions.duplicate")}
          </Item>
        );
      case "lock":
        return (
          <Item key={id} onClick={actions.toggleLock}>
            {page.isLocked ? <LockOpen /> : <Lock />}
            {page.isLocked
              ? t("pages:actions.unlock")
              : t("pages:actions.lock")}
          </Item>
        );
      case "access":
        return (
          <Item key={id} onClick={actions.toggleAccess}>
            {isPrivate ? <Globe /> : <Lock />}
            {isPrivate
              ? t("pages:actions.makePublic")
              : t("pages:actions.makePrivate")}
          </Item>
        );
      case "move":
        return (
          <Item key={id} onClick={actions.openMove}>
            <FolderInput />
            {t("pages:actions.moveToProject")}
          </Item>
        );
      case "archive":
        return (
          <Item key={id} onClick={actions.toggleArchive}>
            {page.archivedAt ? <ArchiveRestore /> : <Archive />}
            {page.archivedAt
              ? t("pages:actions.restore")
              : t("pages:actions.archive")}
          </Item>
        );
      case "delete":
        return (
          <Fragment key={id}>
            <Separator />
            <Item variant="destructive" onClick={actions.openDelete}>
              <Trash2 />
              {t("pages:actions.delete")}
            </Item>
          </Fragment>
        );
      default:
        return null;
    }
  });
}

/** The row's context menu content (right click). */
export function PageContextMenuContent({
  page,
  actions,
  withNewSubpage,
}: Omit<PageMenuItemsProps, "kind">) {
  return (
    <ContextMenuContent className="w-56">
      <PageMenuItems
        page={page}
        actions={actions}
        kind="context"
        withNewSubpage={withNewSubpage}
      />
    </ContextMenuContent>
  );
}

type PageRowActionsProps = {
  page: PageSummary;
  workspaceId: string;
  actions: PageActions;
  withNewSubpage?: boolean;
  /** Adds the favorite toggle (tree rows have no star of their own). */
  withFavorite?: boolean;
  className?: string;
};

/** The "⋯" menu of a page row. */
export default function PageRowActions({
  page,
  workspaceId,
  actions,
  withNewSubpage,
  withFavorite,
  className,
}: PageRowActionsProps) {
  const { t } = useTranslation();
  const title = page.title.trim() || t("pages:list.untitled");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("pages:actions.more", { title })}
            className={cn("text-muted-foreground", className)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onClick={(event) => event.stopPropagation()}
      >
        {withFavorite && (
          <FavoriteButton
            variant="menu-item"
            workspaceId={workspaceId}
            entityType="page"
            entityId={page.id}
            placeholder={{
              name: title,
              projectId: page.projectId,
              icon: page.logoValue,
              feature: "pages",
            }}
          />
        )}
        <PageMenuItems
          page={page}
          actions={actions}
          kind="dropdown"
          withNewSubpage={withNewSubpage}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
