import {
  Archive,
  ArchiveRestore,
  Copy,
  Globe,
  Link2,
  Lock,
  LockOpen,
  Star,
  StarOff,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { pageMenuItemIds } from "@/components/page/page-row-actions";
import { usePageActions } from "@/components/page/use-page-actions";
import { useArchiveCycle } from "@/hooks/mutations/cycle/use-archive-cycle";
import { useUpdateModule } from "@/hooks/mutations/module/use-update-module";
import { useGetCycle } from "@/hooks/queries/cycle/use-get-cycle";
import { useGetModule } from "@/hooks/queries/module/use-get-module";
import { useGetPage } from "@/hooks/queries/page/use-get-page";
import { useFavoriteToggle } from "@/hooks/use-favorite-toggle";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { cyclePath } from "@/lib/cycle/entity-link";
import { canArchiveCycle } from "@/lib/cycle/status";
import { generateLink } from "@/lib/generate-link";
import { modulePath } from "@/lib/module/entity-link";
import { MODULE_STATUS_META, MODULE_STATUS_ORDER } from "@/lib/module/status";
import { toast } from "@/lib/toast";
import type { PaletteActionItem, PaletteGroup } from "./palette-types";

export type EntityRoute =
  | { kind: "page"; projectId: string; id: string }
  | { kind: "cycle"; projectId: string; id: string }
  | { kind: "module"; projectId: string; id: string };

const ENTITY_ROUTE =
  /\/project\/([^/]+)\/(pages|cycles|modules)\/([^/?#]+)(?:[/?#]|$)/;
const KINDS = { pages: "page", cycles: "cycle", modules: "module" } as const;

/** The page, cycle or module the current route has open, if any. */
export function matchEntityRoute(pathname: string): EntityRoute | null {
  const match = ENTITY_ROUTE.exec(pathname);
  if (!match) return null;
  const [, projectId, segment, id] = match;
  if (!projectId || !segment || !id) return null;
  return {
    kind: KINDS[segment as keyof typeof KINDS],
    projectId,
    id: decodeURIComponent(id),
  };
}

const ICON = "size-4 opacity-72";

type SourceProps = {
  workspaceId: string;
  projectId: string;
  id: string;
  onGroup: (group: PaletteGroup | null) => void;
};

/**
 * Publishes `items` under `label` while mounted. Commands read the latest
 * actions through `run`, so the group only changes with what it shows.
 */
function usePublish(
  onGroup: SourceProps["onGroup"],
  value: string,
  label: string | null,
  items: PaletteActionItem[],
) {
  useEffect(() => {
    onGroup(label && items.length > 0 ? { value, label, items } : null);
  }, [onGroup, value, label, items]);
  useEffect(() => () => onGroup(null), [onGroup]);
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function favoriteItem(
  isFavorite: boolean,
  label: string,
  run: () => void,
): PaletteActionItem {
  const Icon = isFavorite ? StarOff : Star;
  return {
    value: "entity:favorite",
    label,
    icon: <Icon aria-hidden className={ICON} />,
    onRun: run,
  };
}

function PageCommands({ workspaceId, id, onGroup }: SourceProps) {
  const { t } = useTranslation();
  const { data: page } = useGetPage(id);
  return page ? (
    <LoadedPageCommands
      page={page}
      workspaceId={workspaceId}
      onGroup={onGroup}
      untitled={t("pages:list.untitled")}
    />
  ) : null;
}

function LoadedPageCommands({
  page,
  workspaceId,
  onGroup,
  untitled,
}: {
  page: NonNullable<ReturnType<typeof useGetPage>["data"]>;
  workspaceId: string;
  onGroup: SourceProps["onGroup"];
  untitled: string;
}) {
  const { t } = useTranslation();
  const actions = useLatest(usePageActions({ page, workspaceId }));
  const favorite = useFavoriteToggle({
    workspaceId,
    entityType: "page",
    entityId: page.id,
    placeholder: {
      name: page.title || untitled,
      projectId: page.projectId,
      feature: "pages",
    },
  });
  const toggleFavorite = useLatest(favorite.toggle);
  const { isFavorite, label: favoriteLabel } = favorite;
  const ids = pageMenuItemIds(page).join(",");

  const items = useMemo<PaletteActionItem[]>(() => {
    const allowed = new Set(ids.split(","));
    const list: PaletteActionItem[] = [
      {
        value: "page:copy-link",
        label: t("pages:actions.copyLink"),
        icon: <Link2 aria-hidden className={ICON} />,
        onRun: () => void actions.current.copyLink(),
      },
      favoriteItem(isFavorite, favoriteLabel, () => toggleFavorite.current()),
    ];
    if (allowed.has("duplicate")) {
      list.push({
        value: "page:duplicate",
        label: t("pages:actions.duplicate"),
        icon: <Copy aria-hidden className={ICON} />,
        onRun: () => actions.current.duplicate(),
      });
    }
    if (allowed.has("lock")) {
      list.push({
        value: "page:lock",
        label: page.isLocked
          ? t("pages:actions.unlock")
          : t("pages:actions.lock"),
        icon: page.isLocked ? (
          <LockOpen aria-hidden className={ICON} />
        ) : (
          <Lock aria-hidden className={ICON} />
        ),
        onRun: () => actions.current.toggleLock(),
      });
    }
    if (allowed.has("access")) {
      const isPrivate = page.access === "private";
      list.push({
        value: "page:access",
        label: isPrivate
          ? t("pages:actions.makePublic")
          : t("pages:actions.makePrivate"),
        icon: isPrivate ? (
          <Globe aria-hidden className={ICON} />
        ) : (
          <Lock aria-hidden className={ICON} />
        ),
        onRun: () => actions.current.toggleAccess(),
      });
    }
    if (allowed.has("archive")) {
      list.push({
        value: "page:archive",
        label: page.archivedAt
          ? t("pages:actions.restore")
          : t("pages:actions.archive"),
        icon: page.archivedAt ? (
          <ArchiveRestore aria-hidden className={ICON} />
        ) : (
          <Archive aria-hidden className={ICON} />
        ),
        onRun: () => actions.current.toggleArchive(),
      });
    }
    return list;
  }, [
    t,
    ids,
    page.isLocked,
    page.access,
    page.archivedAt,
    isFavorite,
    favoriteLabel,
    actions,
    toggleFavorite,
  ]);

  usePublish(onGroup, "this-page", page.title || untitled, items);
  return null;
}

function CycleCommands({ workspaceId, projectId, id, onGroup }: SourceProps) {
  const { t } = useTranslation();
  const { data: cycle } = useGetCycle(projectId, id);
  const { canUpdateCycles, isCheckingPermissions } = useWorkspacePermission();
  const archive = useArchiveCycle();
  const archiveRef = useLatest(archive.mutate);
  const favorite = useFavoriteToggle({
    workspaceId,
    entityType: "cycle",
    entityId: id,
    placeholder: cycle
      ? { name: cycle.name, projectId: cycle.projectId, feature: "cycles" }
      : undefined,
  });
  const toggleFavorite = useLatest(favorite.toggle);
  const { isFavorite, label: favoriteLabel } = favorite;
  const canUpdate = !isCheckingPermissions && canUpdateCycles();

  const items = useMemo<PaletteActionItem[]>(() => {
    if (!cycle) return [];
    const isArchived = Boolean(cycle.archivedAt);
    const list: PaletteActionItem[] = [
      {
        value: "cycle:copy-link",
        label: t("cycles:actions.copyLink"),
        icon: <Link2 aria-hidden className={ICON} />,
        onRun: () =>
          void copyToClipboard(
            generateLink(cyclePath(workspaceId, cycle.projectId, cycle.id)),
          ).then(
            (copied) => copied && toast.success(t("cycles:toast.linkCopied")),
          ),
      },
      favoriteItem(isFavorite, favoriteLabel, () => toggleFavorite.current()),
    ];
    const archivable = isArchived || canArchiveCycle(cycle);
    if (canUpdate && archivable) {
      const next = !isArchived;
      list.push({
        value: "cycle:archive",
        label: next ? t("cycles:actions.archive") : t("cycles:actions.restore"),
        icon: next ? (
          <Archive aria-hidden className={ICON} />
        ) : (
          <ArchiveRestore aria-hidden className={ICON} />
        ),
        onRun: () =>
          archiveRef.current(
            { cycleId: cycle.id, projectId: cycle.projectId, archive: next },
            {
              onSuccess: () =>
                toast.success(
                  next
                    ? t("cycles:toast.archived")
                    : t("cycles:toast.restored"),
                ),
              onError: (error) =>
                toast.error(
                  error.message ||
                    (next
                      ? t("cycles:toast.archiveError")
                      : t("cycles:toast.restoreError")),
                ),
            },
          ),
      });
    }
    return list;
  }, [
    t,
    cycle,
    workspaceId,
    canUpdate,
    isFavorite,
    favoriteLabel,
    archiveRef,
    toggleFavorite,
  ]);

  usePublish(onGroup, "this-cycle", cycle?.name ?? null, items);
  return null;
}

function ModuleCommands({ workspaceId, projectId, id, onGroup }: SourceProps) {
  const { t } = useTranslation();
  const { data: module } = useGetModule(projectId, id);
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();
  const { mutate: updateModule } = useUpdateModule();
  const updateRef = useLatest(updateModule);
  const favorite = useFavoriteToggle({
    workspaceId,
    entityType: "module",
    entityId: id,
    placeholder: module
      ? { name: module.name, projectId: module.projectId, feature: "modules" }
      : undefined,
  });
  const toggleFavorite = useLatest(favorite.toggle);
  const { isFavorite, label: favoriteLabel } = favorite;
  const canUpdate = !isCheckingPermissions && canUpdateModules();

  const items = useMemo<PaletteActionItem[]>(() => {
    if (!module) return [];
    const isArchived = Boolean(module.archivedAt);
    const list: PaletteActionItem[] = [
      {
        value: "module:copy-link",
        label: t("modules:actions.copyLink"),
        icon: <Link2 aria-hidden className={ICON} />,
        onRun: () =>
          void copyToClipboard(
            generateLink(modulePath(workspaceId, module.projectId, module.id)),
          ).then(
            (copied) => copied && toast.success(t("modules:toast.linkCopied")),
          ),
      },
    ];
    if (!isArchived) {
      list.push(
        favoriteItem(isFavorite, favoriteLabel, () => toggleFavorite.current()),
      );
    }
    // Same rule as the status chip: archived modules are read-only.
    if (canUpdate && !isArchived) {
      const meta = MODULE_STATUS_META[module.status];
      const StatusIcon = meta.icon;
      list.push({
        value: "module:status",
        label: t("modules:form.status"),
        hint: t(meta.labelKey),
        icon: <StatusIcon aria-hidden className={ICON} />,
        onRun: () => {},
        submenu: () => ({
          label: t("modules:form.status"),
          items: MODULE_STATUS_ORDER.map((status) => {
            const option = MODULE_STATUS_META[status];
            const Icon = option.icon;
            return {
              value: `module-status:${status}`,
              label: t(option.labelKey),
              icon: (
                <Icon
                  aria-hidden
                  className={`size-4 ${option.iconClassName}`}
                />
              ),
              onRun: () => {
                if (status === module.status) return;
                updateRef.current(
                  {
                    moduleId: module.id,
                    projectId: module.projectId,
                    json: { status },
                  },
                  {
                    onError: (error) =>
                      toast.error(
                        error.message || t("modules:toast.saveError"),
                      ),
                  },
                );
              },
            };
          }),
        }),
      });
    }
    return list;
  }, [
    t,
    module,
    workspaceId,
    canUpdate,
    isFavorite,
    favoriteLabel,
    updateRef,
    toggleFavorite,
  ]);

  usePublish(onGroup, "this-module", module?.name ?? null, items);
  return null;
}

/**
 * The open page's, cycle's or module's commands for the palette. Mounted
 * with the palette, so a command's toasts outlive the closed dialog; its
 * reads are the screen's own cached queries.
 */
export function EntityCommandsSource({
  pathname,
  workspaceId,
  onGroup,
}: {
  pathname: string;
  workspaceId: string | undefined;
  onGroup: (group: PaletteGroup | null) => void;
}) {
  const route = matchEntityRoute(pathname);
  if (!route || !workspaceId) return null;
  const key = `${route.kind}:${route.id}`;
  const props = {
    workspaceId,
    projectId: route.projectId,
    id: route.id,
    onGroup,
  };
  switch (route.kind) {
    case "page":
      return <PageCommands key={key} {...props} />;
    case "cycle":
      return <CycleCommands key={key} {...props} />;
    case "module":
      return <ModuleCommands key={key} {...props} />;
    default:
      return null;
  }
}
