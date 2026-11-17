import { Copy, FolderInput, Search, SearchX } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { ProjectTile } from "@/components/context-panel/panel-primitives";
import { categoryIcon } from "@/components/project-templates/category-icons";
import {
  preloadTemplateArt,
  TemplateArt,
} from "@/components/project-templates/template-art";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ProjectTemplateCategory,
  ProjectTemplateSummary,
} from "@/fetchers/project-template/project-templates";
import { cn } from "@/lib/cn";
import {
  ALL_CATEGORY,
  BLANK_TEMPLATE_ID,
  CATEGORY_GROUPS,
  FROM_WORKSPACE_CATEGORY,
  GUIDED_TOUR_TEMPLATE_ID,
  RECOMMENDED_CATEGORY,
  recommendedTemplates,
  searchTemplates,
  templatesInCategory,
  visibleCategories,
} from "@/lib/project-template-gallery";
import { type CreateSource, sameSource } from "./create-flow-model";

export type GalleryProject = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
};

type Tile =
  | { kind: "blank" }
  | { kind: "existing" }
  | { kind: "template"; template: ProjectTemplateSummary }
  | { kind: "project"; project: GalleryProject };

function tileKey(tile: Tile) {
  if (tile.kind === "template") return `t:${tile.template.id}`;
  if (tile.kind === "project") return `p:${tile.project.id}`;
  return tile.kind;
}

function tileSource(tile: Tile): CreateSource | null {
  if (tile.kind === "blank") return { kind: "blank" };
  if (tile.kind === "template")
    return { kind: "template", id: tile.template.id };
  if (tile.kind === "project") return { kind: "project", id: tile.project.id };
  return null;
}

function isTileChecked(tile: Tile, source: CreateSource) {
  const own = tileSource(tile);
  return own ? sameSource(own, source) : false;
}

/** Items in the same row as the first one: the grid's column count. */
function columnsOf(items: HTMLElement[]) {
  if (items.length < 2) return 1;
  // Without layout (jsdom) every offset is 0: treat it as one column.
  const laidOut = items.some(
    (item) =>
      item.offsetTop !== items[0].offsetTop ||
      item.offsetLeft !== items[0].offsetLeft,
  );
  if (!laidOut) return 1;
  return Math.max(
    1,
    items.filter((item) => item.offsetTop === items[0].offsetTop).length,
  );
}

/**
 * A radio group of tiles: arrows move and select (radio semantics), Space
 * selects, Enter (or a double-click) selects and continues.
 */
function TileGroup({
  labelledBy,
  tiles,
  source,
  onSelect,
  onActivate,
  onExisting,
  renderTile,
  className,
}: {
  labelledBy: string;
  tiles: Tile[];
  source: CreateSource;
  onSelect: (source: CreateSource) => void;
  onActivate: (source: CreateSource) => void;
  onExisting: () => void;
  renderTile: (tile: Tile, checked: boolean) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const checkedIndex = tiles.findIndex((tile) => isTileChecked(tile, source));
  const focusIndex = checkedIndex === -1 ? 0 : checkedIndex;

  const choose = (tile: Tile, activate = false) => {
    if (tile.kind === "existing") {
      onExisting();
      return;
    }
    const next = tileSource(tile);
    if (!next) return;
    if (activate) onActivate(next);
    else onSelect(next);
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLElement>("[role=radio]") ?? [],
    );
    const columns = columnsOf(items);
    const rtl = document.documentElement.dir === "rtl";
    let next = -1;
    switch (event.key) {
      case "ArrowRight":
        next = index + (rtl ? -1 : 1);
        break;
      case "ArrowLeft":
        next = index + (rtl ? 1 : -1);
        break;
      case "ArrowDown":
        next = index + columns;
        break;
      case "ArrowUp":
        next = index - columns;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tiles.length - 1;
        break;
      case "Enter":
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        choose(tiles[index], true);
        return;
      case " ":
        event.preventDefault();
        choose(tiles[index]);
        return;
      default:
        return;
    }
    event.preventDefault();
    next = Math.min(Math.max(next, 0), tiles.length - 1);
    items[next]?.focus();
    // "Start from an existing project" only moves focus; it jumps on Space.
    if (tiles[next].kind !== "existing") choose(tiles[next]);
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={className}
    >
      {tiles.map((tile, index) => {
        const checked = isTileChecked(tile, source);
        return (
          // biome-ignore lint/a11y/useSemanticElements: rich tiles with radio semantics; Enter chooses and continues
          <button
            key={tileKey(tile)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => choose(tile)}
            onDoubleClick={() => choose(tile, true)}
            onKeyDown={(event) => onKeyDown(event, index)}
            data-tile={tileKey(tile)}
            className={cn(
              "group relative flex min-h-11 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-start outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.98] motion-reduce:active:scale-100",
              checked &&
                "border-primary ring-1 ring-primary hover:border-primary",
            )}
          >
            {renderTile(tile, checked)}
          </button>
        );
      })}
    </div>
  );
}

function CategoryRail({
  categories,
  categoryId,
  onCategory,
  showRecommended,
  showFromWorkspace,
  controls,
  footer,
}: {
  categories: ProjectTemplateCategory[];
  categoryId: string;
  onCategory: (id: string) => void;
  showRecommended: boolean;
  showFromWorkspace: boolean;
  controls: string;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const fixed = [
    ...(showRecommended
      ? [
          {
            id: RECOMMENDED_CATEGORY,
            name: t("common:modals.createProject.choose.recommended"),
          },
        ]
      : []),
    { id: ALL_CATEGORY, name: t("common:modals.createProject.choose.all") },
  ];
  const groups = CATEGORY_GROUPS.map((group) => ({
    ...group,
    items: group.categories
      .map((id) => byId.get(id))
      .filter((category): category is ProjectTemplateCategory =>
        Boolean(category),
      ),
  })).filter((group) => group.items.length > 0);
  const order = [
    ...fixed.map((item) => item.id),
    ...groups.flatMap((group) => group.items.map((item) => item.id)),
    ...(showFromWorkspace ? [FROM_WORKSPACE_CATEGORY] : []),
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = order.indexOf(categoryId);
    const rtl = document.documentElement.dir === "rtl";
    let next: number;
    if (
      event.key === "ArrowDown" ||
      event.key === (rtl ? "ArrowLeft" : "ArrowRight")
    )
      next = index + 1;
    else if (
      event.key === "ArrowUp" ||
      event.key === (rtl ? "ArrowRight" : "ArrowLeft")
    )
      next = index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    else return;
    event.preventDefault();
    const id = order[Math.min(Math.max(next, 0), order.length - 1)];
    onCategory(id);
    ref.current?.querySelector<HTMLElement>(`[data-category="${id}"]`)?.focus();
  };

  const tab = (
    id: string,
    name: string,
    Icon?: ReturnType<typeof categoryIcon>,
  ) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={categoryId === id}
      aria-controls={controls}
      tabIndex={categoryId === id ? 0 : -1}
      data-category={id}
      onClick={() => onCategory(id)}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border px-3 text-start text-sm outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:w-full md:rounded-md md:border-transparent md:px-2",
        categoryId === id
          ? "bg-accent font-medium text-foreground md:bg-accent"
          : "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="hidden size-4 shrink-0 md:block" aria-hidden />}
      <span className="truncate">{name}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-col gap-2 md:gap-3">
      <div
        ref={ref}
        role="tablist"
        aria-orientation="vertical"
        aria-label={t("common:modals.createProject.choose.categories")}
        className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0"
      >
        {fixed.map((item) => tab(item.id, item.name))}
        {groups.map((group) => (
          <div key={group.id} className="contents md:block md:pt-3">
            <p
              aria-hidden
              className="hidden px-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide md:block"
            >
              {t(group.labelKey)}
            </p>
            {group.items.map((category) =>
              tab(category.id, category.name, categoryIcon(category.id)),
            )}
          </div>
        ))}
        {showFromWorkspace && (
          <div className="contents md:block md:border-border md:border-t md:pt-2 md:mt-2">
            {tab(
              FROM_WORKSPACE_CATEGORY,
              t("common:modals.createProject.choose.fromWorkspace"),
              Copy,
            )}
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}

function TemplateTileBody({
  name,
  note,
  artId,
  chip,
  compact,
}: {
  name: string;
  note: string;
  artId: string | null;
  chip?: string;
  compact?: boolean;
}) {
  return (
    <>
      {!compact && (
        <TemplateArt
          id={artId}
          className="pointer-events-none border-border border-b"
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <span className="font-medium text-foreground text-sm leading-snug">
          {name}
        </span>
        <span className="line-clamp-2 text-muted-foreground text-xs">
          {note}
        </span>
        {chip && (
          <Badge
            variant="outline"
            className="mt-auto block max-w-full self-start truncate font-normal"
            title={chip}
          >
            {chip}
          </Badge>
        )}
      </span>
    </>
  );
}

export type TemplateGalleryProps = {
  templates: ProjectTemplateSummary[];
  categories: ProjectTemplateCategory[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  projects: GalleryProject[];
  categoryId: string;
  onCategory: (id: string) => void;
  query: string;
  onQuery: (query: string) => void;
  source: CreateSource;
  onSelect: (source: CreateSource) => void;
  onActivate: (source: CreateSource) => void;
  onStartBlank: () => void;
  onImport?: () => void;
  intent?: string | null;
  lastTemplateId?: string | null;
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Polite announcement of async results (the result count). */
  announce?: (message: string) => void;
  /** The preview column (desktop) or nothing. */
  preview?: ReactNode;
};

/** P1: categories, search, the tile grid and the preview beside it. */
export function TemplateGallery({
  templates,
  categories,
  isLoading,
  isError,
  onRetry,
  projects,
  categoryId,
  onCategory,
  query,
  onQuery,
  source,
  onSelect,
  onActivate,
  onStartBlank,
  onImport,
  intent,
  lastTemplateId,
  searchRef,
  announce,
  preview,
}: TemplateGalleryProps) {
  const { t } = useTranslation();
  const gridId = useId();
  const headingId = useId();
  const shownCategories = useMemo(
    () => visibleCategories(categories, templates),
    [categories, templates],
  );
  const hasBlankTemplate = templates.some(
    (template) => template.id === BLANK_TEMPLATE_ID,
  );
  const searching = query.trim().length > 0;
  const activeCategory = searching ? ALL_CATEGORY : categoryId;

  const listed = useMemo(() => {
    if (searching) return searchTemplates(templates, categories, query);
    if (activeCategory === RECOMMENDED_CATEGORY)
      return recommendedTemplates(templates, { intent, lastTemplateId });
    if (activeCategory === ALL_CATEGORY)
      return templates.filter((template) => template.id !== BLANK_TEMPLATE_ID);
    if (activeCategory === FROM_WORKSPACE_CATEGORY) return [];
    return templatesInCategory(templates, activeCategory);
  }, [
    searching,
    templates,
    categories,
    query,
    activeCategory,
    intent,
    lastTemplateId,
  ]);

  // Load the arts of the cards on screen ahead of rendering them.
  useEffect(() => {
    preloadTemplateArt([
      BLANK_TEMPLATE_ID,
      ...listed.slice(0, 12).map((template) => template.id),
    ]);
  }, [listed]);

  const announced = useRef<string>("");
  useEffect(() => {
    if (!searching) return;
    const message = t("common:modals.createProject.choose.resultCount", {
      count: listed.length,
    });
    if (message === announced.current) return;
    announced.current = message;
    const id = window.setTimeout(() => announce?.(message), 400);
    return () => window.clearTimeout(id);
  }, [searching, listed.length, announce, t]);

  const categoryName = (id: string) =>
    shownCategories.find((category) => category.id === id)?.name ??
    categories.find((category) => category.id === id)?.name;

  const heading = searching
    ? t("common:modals.createProject.choose.searchResults")
    : activeCategory === RECOMMENDED_CATEGORY
      ? t("common:modals.createProject.choose.recommended")
      : activeCategory === ALL_CATEGORY
        ? t("common:modals.createProject.choose.all")
        : activeCategory === FROM_WORKSPACE_CATEGORY
          ? t("common:modals.createProject.choose.fromWorkspace")
          : (categoryName(activeCategory) ?? "");

  const tiles: Tile[] =
    activeCategory === FROM_WORKSPACE_CATEGORY
      ? projects.map((project) => ({ kind: "project", project }))
      : [
          ...(searching ? [] : ([{ kind: "blank" }] as Tile[])),
          ...(searching || projects.length === 0
            ? []
            : ([{ kind: "existing" }] as Tile[])),
          ...listed.map((template) => ({ kind: "template", template }) as Tile),
        ];

  const showRecommended = true;
  const guidedTour = templates.find(
    (template) => template.id === GUIDED_TOUR_TEMPLATE_ID,
  );

  const renderTile = (tile: Tile) => {
    if (tile.kind === "blank") {
      const blank = templates.find(
        (template) => template.id === BLANK_TEMPLATE_ID,
      );
      return (
        <TemplateTileBody
          name={t("common:modals.createProject.choose.blankName")}
          note={
            hasBlankTemplate && blank
              ? blank.pitch
              : t("common:modals.createProject.choose.blankNote")
          }
          artId={BLANK_TEMPLATE_ID}
        />
      );
    }
    if (tile.kind === "existing") {
      return (
        <span className="flex flex-1 flex-col gap-2 p-3">
          <span className="flex aspect-[8/5] w-full items-center justify-center rounded-lg bg-muted/60">
            <Copy className="size-6 text-muted-foreground" aria-hidden />
          </span>
          <span className="font-medium text-foreground text-sm">
            {t("common:modals.createProject.choose.existingName")}
          </span>
          <span className="line-clamp-2 text-muted-foreground text-xs">
            {t("common:modals.createProject.choose.existingNote")}
          </span>
        </span>
      );
    }
    if (tile.kind === "project") {
      return (
        <span className="flex min-w-0 items-center gap-3 p-3">
          <ProjectTile
            icon={tile.project.icon}
            seed={tile.project.id}
            className="size-8"
          />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground text-sm">
              {tile.project.name}
            </span>
            <span className="block font-mono text-muted-foreground text-xs">
              {tile.project.slug}
            </span>
          </span>
        </span>
      );
    }
    const template = tile.template;
    return (
      <TemplateTileBody
        name={template.name}
        note={template.pitch}
        artId={template.id}
        chip={categoryName(template.categories[0] ?? "")}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <InputGroup className="shrink-0">
        <SearchField query={query} onQuery={onQuery} searchRef={searchRef} />
      </InputGroup>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 md:grid-cols-[13rem_minmax(0,1fr)] md:grid-rows-1 md:gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        <div className="flex min-h-0 flex-col gap-2 md:overflow-y-auto md:pe-1">
          <CategoryRail
            categories={shownCategories}
            categoryId={activeCategory}
            onCategory={onCategory}
            showRecommended={showRecommended}
            showFromWorkspace={projects.length > 0}
            controls={gridId}
            footer={
              onImport ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onImport}
                  className="hidden justify-start text-muted-foreground md:mt-auto md:flex"
                >
                  <FolderInput className="size-4" aria-hidden />
                  <span className="truncate">
                    {t("common:modals.createProject.choose.import")}
                  </span>
                </Button>
              ) : null
            }
          />
        </div>

        <div
          id={gridId}
          role="tabpanel"
          aria-labelledby={headingId}
          className="min-h-0 overflow-y-auto pe-1"
        >
          <h3
            id={headingId}
            className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide"
          >
            {heading}
          </h3>
          {isError ? (
            <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
              <p className="text-muted-foreground">
                {t("common:modals.createProject.choose.loadError")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRetry}
              >
                {t("common:modals.createProject.tryAgain")}
              </Button>
            </div>
          ) : isLoading ? (
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
              aria-hidden
            >
              {Array.from({ length: 6 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton tiles
                <Skeleton key={index} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : searching && tiles.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title={t("common:modals.createProject.choose.noResultsTitle", {
                query: query.trim(),
              })}
              description={t(
                "common:modals.createProject.choose.noResultsBody",
              )}
              action={
                <Button type="button" size="sm" onClick={onStartBlank}>
                  {t("common:modals.createProject.choose.startBlank")}
                </Button>
              }
              secondaryAction={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onQuery("")}
                >
                  {t("common:modals.createProject.choose.clearSearch")}
                </Button>
              }
            />
          ) : (
            <TileGroup
              labelledBy={headingId}
              tiles={tiles}
              source={source}
              onSelect={onSelect}
              onActivate={onActivate}
              onExisting={() => onCategory(FROM_WORKSPACE_CATEGORY)}
              renderTile={renderTile}
              className={cn(
                "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
                activeCategory === FROM_WORKSPACE_CATEGORY && "xl:grid-cols-2",
              )}
            />
          )}
          {guidedTour && !searching && activeCategory === ALL_CATEGORY && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-3 px-0"
              onClick={() =>
                onSelect({ kind: "template", id: GUIDED_TOUR_TEMPLATE_ID })
              }
            >
              {t("common:modals.createProject.choose.guidedTour")}
            </Button>
          )}
          {onImport && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onImport}
              className="mt-3 text-muted-foreground md:hidden"
            >
              <FolderInput className="size-4" aria-hidden />
              {t("common:modals.createProject.choose.import")}
            </Button>
          )}
        </div>

        {preview && (
          <div className="hidden min-h-0 overflow-y-auto border-border border-s ps-4 lg:block">
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}

/** The search box; `/` focuses it while the dialog is open. */
export function SearchField({
  query,
  onQuery,
  searchRef,
}: {
  query: string;
  onQuery: (query: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <InputGroupAddon>
        <Search aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        ref={searchRef}
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            onQuery("");
          }
        }}
        placeholder={t("common:modals.createProject.choose.search")}
        aria-label={t("common:modals.createProject.choose.search")}
        className="text-base sm:text-sm"
      />
      <InputGroupAddon align="inline-end" className="max-sm:hidden">
        <Kbd>/</Kbd>
      </InputGroupAddon>
    </>
  );
}

/**
 * Onboarding's first-project row: Blank, then up to three recommendations
 * for the workspace intent. "Browse all templates" opens the full gallery.
 */
export function CompactTemplatePicker({
  templates,
  categories,
  isLoading,
  intent,
  source,
  onSelect,
  onActivate,
  labelledBy,
}: {
  templates: ProjectTemplateSummary[];
  categories: ProjectTemplateCategory[];
  isLoading: boolean;
  intent?: string | null;
  source: CreateSource;
  onSelect: (source: CreateSource) => void;
  onActivate: (source: CreateSource) => void;
  labelledBy: string;
}) {
  const { t } = useTranslation();
  const picks = useMemo(
    () => recommendedTemplates(templates, { intent }).slice(0, 3),
    [templates, intent],
  );
  useEffect(() => {
    preloadTemplateArt([BLANK_TEMPLATE_ID, ...picks.map((pick) => pick.id)]);
  }, [picks]);
  if (isLoading) {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-hidden
      >
        {Array.from({ length: 4 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton tiles
          <Skeleton key={index} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }
  const blank = templates.find((template) => template.id === BLANK_TEMPLATE_ID);
  const categoryName = (id: string) =>
    categories.find((category) => category.id === id)?.name;
  const tiles: Tile[] = [
    { kind: "blank" },
    ...picks.map((template) => ({ kind: "template", template }) as Tile),
  ];
  return (
    <TileGroup
      labelledBy={labelledBy}
      tiles={tiles}
      source={source}
      onSelect={onSelect}
      onActivate={onActivate}
      onExisting={() => {}}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      renderTile={(tile) =>
        tile.kind === "template" ? (
          <TemplateTileBody
            name={tile.template.name}
            note={tile.template.pitch}
            artId={tile.template.id}
            chip={categoryName(tile.template.categories[0] ?? "")}
          />
        ) : (
          <TemplateTileBody
            name={t("common:modals.createProject.choose.blankName")}
            note={
              blank?.pitch ?? t("common:modals.createProject.choose.blankNote")
            }
            artId={BLANK_TEMPLATE_ID}
          />
        )
      }
    />
  );
}
