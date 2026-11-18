import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilesEntries, FolderIcon } from "./components/files-entries";
import { FilesMenu, type MenuItem } from "./components/files-menu";
import { FilesPreviewPanel } from "./components/files-preview";
import {
  type FileEntry,
  type FilesOverview,
  type FolderView,
  filesApi,
  filesEvents,
  type Place,
  type SearchOutcome,
} from "./lib/files-api";
import {
  DEFAULT_SORT,
  filterEntries,
  type Sort,
  type SortKey,
  sortEntries,
  type ViewMode,
} from "./lib/files-model";
import { useT } from "./lib/i18n";
import { type CommandError, isCommandError } from "./lib/ipc";
import "./files.css";

/** Where the main pane is. */
type Location =
  | { kind: "folder"; path: string }
  | { kind: "recent" }
  | { kind: "dropped" };

type Menu = {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
};

type Notice = { tone: "info" | "error"; text: string };

const STORAGE = {
  view: "margaya.files.view",
  sort: "margaya.files.sort",
  hidden: "margaya.files.hidden",
  width: "margaya.files.previewWidth",
};

/** Waits this long after typing before a subfolder search starts. */
export const SEARCH_DELAY_MS = 300;
const PREVIEW_MIN = 280;
const PREVIEW_DEFAULT = 440;

function readStored<T>(
  key: string,
  parse: (text: string) => T | null,
): T | null {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? null : parse(text);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the choice just isn't remembered.
  }
}

function parseSort(text: string): Sort | null {
  const [key, direction] = text.split(":");
  const keys: SortKey[] = ["name", "modified", "type", "size"];
  if (!keys.includes(key as SortKey)) return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { key: key as SortKey, direction };
}

function errorKind(error: unknown): CommandError["kind"] | null {
  return isCommandError(error) ? error.kind : null;
}

let nextSearchId = 1;

export function Files() {
  const t = useT();
  const [overview, setOverview] = useState<FilesOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [folder, setFolder] = useState<FolderView | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<unknown>(null);
  const [dropped, setDropped] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false);
  const [found, setFound] = useState<SearchOutcome | null>(null);
  const [searching, setSearching] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>(
    () =>
      readStored(STORAGE.view, (text) =>
        text === "grid" || text === "list" ? text : null,
      ) ?? "list",
  );
  const [sort, setSort] = useState<Sort>(
    () => readStored(STORAGE.sort, parseSort) ?? DEFAULT_SORT,
  );
  const [showHidden, setShowHidden] = useState(
    () => readStored(STORAGE.hidden, (text) => text === "1") ?? false,
  );
  const [selected, setSelected] = useState(-1);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(
    () =>
      readStored(STORAGE.width, (text) => {
        const value = Number(text);
        return Number.isFinite(value) && value >= PREVIEW_MIN ? value : null;
      }) ?? PREVIEW_DEFAULT,
  );
  const [menu, setMenu] = useState<Menu | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<Location | null>(null);
  locationRef.current = location;

  const refreshOverview = useCallback(async () => {
    try {
      const next = await filesApi.overview();
      setOverview(next);
      setOverviewFailed(false);
      return next;
    } catch {
      setOverviewFailed(true);
      return null;
    }
  }, []);

  const loadFolder = useCallback(async (path: string) => {
    setFolderLoading(true);
    setFolderError(null);
    try {
      const next = await filesApi.list(path);
      const current = locationRef.current;
      if (current?.kind === "folder" && current.path === path) {
        setFolder(next);
      }
    } catch (error) {
      const current = locationRef.current;
      if (current?.kind === "folder" && current.path === path) {
        setFolder(null);
        setFolderError(error);
      }
    } finally {
      setFolderLoading(false);
    }
  }, []);

  const go = useCallback((next: Location) => {
    setLocation(next);
    setSelected(-1);
    setQuery("");
    setFound(null);
    setMenu(null);
    if (next.kind !== "folder") {
      setFolder(null);
      setFolderError(null);
    }
  }, []);

  // First load: the first place that is there, else Recent.
  useEffect(() => {
    void refreshOverview().then((first) => {
      if (!first || locationRef.current) return;
      const place = first.places.find((item) => item.available);
      if (place) go({ kind: "folder", path: place.path });
      else if (first.recent.length > 0) go({ kind: "recent" });
    });
  }, [refreshOverview, go]);

  useEffect(() => {
    if (location?.kind === "folder") void loadFolder(location.path);
  }, [location, loadFolder]);

  const openPreview = useCallback(
    (entry: FileEntry) => {
      setPreview(entry);
      void filesApi
        .addRecent(entry.path)
        .then(() => refreshOverview())
        .catch(() => {});
    },
    [refreshOverview],
  );

  // Dropped files preview at once; dropped folders become places.
  useEffect(() => {
    const subscriptions = [
      filesEvents.dropped((result) => {
        if (result.files.length > 0) {
          setDropped((current) => {
            const paths = new Set(result.files.map((file) => file.path));
            return [
              ...result.files,
              ...current.filter((file) => !paths.has(file.path)),
            ];
          });
          go({ kind: "dropped" });
          const first = result.files[0];
          if (first) openPreview(first);
        }
        if (result.places > 0) {
          void refreshOverview();
          setNotice({
            tone: "info",
            text: t("files.placesAdded", { count: result.places }),
          });
        }
        if (result.refused > 0) {
          setNotice({ tone: "error", text: t("files.droppedRefused") });
        }
      }),
      filesEvents.shown(() => void refreshOverview()),
    ];
    return () => {
      for (const subscription of subscriptions)
        void subscription.then((stop) => stop());
    };
  }, [go, openPreview, refreshOverview, t]);

  // Searching subfolders: after a pause in typing, one search at a time.
  useEffect(() => {
    if (!deep || location?.kind !== "folder" || query.trim() === "") {
      setFound(null);
      return;
    }
    const id = nextSearchId++;
    let live = true;
    const timer = window.setTimeout(() => {
      setSearching(id);
      filesApi
        .search(location.path, query, showHidden, id)
        .then((outcome) => {
          if (live) setFound(outcome);
        })
        .catch(() => {
          if (live)
            setFound({ entries: [], truncated: false, cancelled: true });
        })
        .finally(() => {
          setSearching((current) => (current === id ? null : current));
        });
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
      void filesApi.cancelSearch(id).catch(() => {});
    };
  }, [deep, location, query, showHidden]);

  const cancelSearch = () => {
    if (searching !== null) void filesApi.cancelSearch(searching);
  };

  const recentEntries = useMemo(
    () =>
      (overview?.recent ?? [])
        .filter((item) => item.available)
        .map((item) => ({ ...item, folder: parentOf(item.path) })),
    [overview],
  );

  const shown: FileEntry[] = useMemo(() => {
    if (location?.kind === "recent") {
      return filterEntries(recentEntries, query, true);
    }
    if (location?.kind === "dropped") {
      return filterEntries(
        dropped.map((item) => ({ ...item, folder: parentOf(item.path) })),
        query,
        true,
      );
    }
    if (found) return sortEntries(found.entries, sort);
    return sortEntries(
      filterEntries(folder?.entries ?? [], query, showHidden),
      sort,
    );
  }, [
    location,
    recentEntries,
    dropped,
    found,
    folder,
    query,
    showHidden,
    sort,
  ]);

  const selectedEntry = selected >= 0 ? shown[selected] : undefined;
  const crumbs = folder?.crumbs ?? [];
  const up = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
  const currentPlace = overview?.places.find(
    (place) => place.id === folder?.placeId,
  );

  const refresh = useCallback(() => {
    void refreshOverview();
    if (locationRef.current?.kind === "folder") {
      void loadFolder(locationRef.current.path);
    }
  }, [refreshOverview, loadFolder]);

  const say = (tone: Notice["tone"], text: string) => setNotice({ tone, text });

  const fail = (error: unknown, fallback: string) => {
    switch (errorKind(error)) {
      case "fileRunsCode":
        say("error", t("files.runsCode"));
        break;
      case "fileOutside":
      case "fileNoAccess":
        say("error", t("files.deniedTitle"));
        break;
      case "fileMissing":
        say("error", t("files.missingFile"));
        break;
      case "fileSameFile":
        say("error", t("files.sameFile"));
        break;
      default:
        say("error", fallback);
    }
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "folder") go({ kind: "folder", path: entry.path });
    else if (entry.kind === "file") openPreview(entry);
  };

  const openExternal = (entry: FileEntry) =>
    void filesApi
      .open(entry.path)
      .catch((error) => fail(error, t("files.openFailed")));

  const saveCopy = (entry: FileEntry) =>
    void filesApi
      .saveCopy(entry.path)
      .then((saved) => {
        if (saved) say("info", t("files.saved", { path: saved }));
      })
      .catch((error) => fail(error, t("files.saveFailed")));

  const reveal = (path: string) =>
    void filesApi
      .reveal(path)
      .catch((error) => fail(error, t("files.openFailed")));

  const copyPath = (path: string) =>
    void filesApi
      .copyPath(path)
      .then(() => say("info", t("files.pathCopied")))
      .catch((error) => fail(error, t("files.openFailed")));

  const addFolder = async () => {
    try {
      const id = await filesApi.addFolder();
      if (!id) return;
      const next = await refreshOverview();
      const place = next?.places.find((item) => item.id === id);
      if (place) go({ kind: "folder", path: place.path });
    } catch (error) {
      if (errorKind(error) === "fileTooMany")
        say("error", t("files.tooManyPlaces"));
      else fail(error, t("files.addFailed"));
    }
  };

  const removeFolder = async (place: Place) => {
    try {
      await filesApi.removeFolder(place.id);
      const next = await refreshOverview();
      if (folder?.placeId === place.id || currentPlace?.id === place.id) {
        const other = next?.places.find((item) => item.available);
        if (other) go({ kind: "folder", path: other.path });
        else {
          setLocation(null);
          setFolder(null);
          setFolderError(null);
        }
      }
      if (preview && isInside(preview.path, place.path)) setPreview(null);
    } catch (error) {
      fail(error, t("files.openFailed"));
    }
  };

  const inRecent = (entry: FileEntry) =>
    (overview?.recent ?? []).some((item) => item.path === entry.path);

  const entryMenu = (entry: FileEntry, x: number, y: number) => {
    const items: MenuItem[] =
      entry.kind === "folder"
        ? [
            {
              id: "open",
              label: t("files.open"),
              onSelect: () => openEntry(entry),
            },
            {
              id: "reveal",
              label: t("files.showInFolder"),
              onSelect: () => reveal(entry.path),
            },
            {
              id: "copy",
              label: t("files.copyPath"),
              onSelect: () => copyPath(entry.path),
            },
          ]
        : [
            {
              id: "preview",
              label: t("files.previewAction"),
              onSelect: () => openPreview(entry),
            },
            {
              id: "open",
              label: t("files.openDefault"),
              onSelect: () => openExternal(entry),
            },
            {
              id: "reveal",
              label: t("files.showInFolder"),
              onSelect: () => reveal(entry.path),
            },
            {
              id: "copy",
              label: t("files.copyPath"),
              onSelect: () => copyPath(entry.path),
            },
            {
              id: "save",
              label: t("files.saveCopy"),
              onSelect: () => saveCopy(entry),
            },
            inRecent(entry)
              ? {
                  id: "recent",
                  label: t("files.removeRecent"),
                  onSelect: () =>
                    void filesApi
                      .removeRecent(entry.path)
                      .then(() => refreshOverview())
                      .catch(() => {}),
                }
              : {
                  id: "recent",
                  label: t("files.addRecent"),
                  onSelect: () =>
                    void filesApi
                      .addRecent(entry.path)
                      .then(() => refreshOverview())
                      .catch((error) => fail(error, t("files.openFailed"))),
                },
          ];
    if (entry.kind === "other") return;
    setMenu({ x, y, label: t("files.menu", { name: entry.name }), items });
  };

  const placeMenu = (place: Place, x: number, y: number) => {
    setMenu({
      x,
      y,
      label: t("files.menu", { name: place.name }),
      items: [
        {
          id: "open",
          label: t("files.open"),
          disabled: !place.available,
          onSelect: () => go({ kind: "folder", path: place.path }),
        },
        {
          id: "reveal",
          label: t("files.showInFolder"),
          disabled: !place.available,
          onSelect: () => reveal(place.path),
        },
        {
          id: "copy",
          label: t("files.copyPath"),
          disabled: !place.available,
          onSelect: () => copyPath(place.path),
        },
        {
          id: "remove",
          label: t("files.removeFolder"),
          onSelect: () => void removeFolder(place),
        },
      ],
    });
  };

  const menuAtSelection = () => {
    const entry = selectedEntry;
    const list = listRef.current;
    if (!entry || !list) return;
    const option = list.querySelector('[aria-selected="true"]');
    const rect = (option ?? list).getBoundingClientRect();
    entryMenu(entry, rect.left + 16, rect.top + rect.height / 2);
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && selectedEntry) {
      event.preventDefault();
      openEntry(selectedEntry);
    } else if (event.key === "Backspace" && up) {
      event.preventDefault();
      go({ kind: "folder", path: up.path });
    } else if (event.key === "Delete") {
      // Read-only: deleting files is never offered here.
      event.preventDefault();
    } else if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault();
      menuAtSelection();
    }
  };

  // Window keys: Ctrl+F finds, F5 refreshes (instead of reloading the
  // page), Escape leaves the expanded preview or clears the filter.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        if ((event.target as Element | null)?.closest?.(".files-preview-body"))
          return;
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (
        event.key === "F5" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
      ) {
        event.preventDefault();
        refresh();
      } else if (event.key === "Escape" && !event.defaultPrevented) {
        if (expanded) setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, expanded]);

  const setViewMode = (next: ViewMode) => {
    setView(next);
    writeStored(STORAGE.view, next);
  };
  const changeSort = (next: Sort) => {
    setSort(next);
    writeStored(STORAGE.sort, `${next.key}:${next.direction}`);
  };
  const toggleHidden = () => {
    setShowHidden((value) => {
      writeStored(STORAGE.hidden, value ? "0" : "1");
      return !value;
    });
  };

  // The preview's width: drag the divider, or arrow keys on it.
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizing.current = { x: event.clientX, width: previewWidth };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const clampWidth = (value: number) =>
    Math.round(
      Math.max(
        PREVIEW_MIN,
        Math.min(value, Math.max(PREVIEW_MIN, window.innerWidth - 420)),
      ),
    );
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizing.current;
    if (!start) return;
    setPreviewWidth(clampWidth(start.width + (start.x - event.clientX)));
  };
  const onResizeEnd = () => {
    if (!resizing.current) return;
    resizing.current = null;
    writeStored(STORAGE.width, String(previewWidth));
  };
  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clampWidth(previewWidth + delta);
    setPreviewWidth(next);
    writeStored(STORAGE.width, String(next));
  };

  const places = overview?.places ?? [];
  const nothingYet =
    overview !== null &&
    places.length === 0 &&
    overview.recent.length === 0 &&
    dropped.length === 0;

  let body: ReactNode;
  if (overview === null && !overviewFailed) {
    body = (
      <p className="files-state" role="status">
        {t("files.loading")}
      </p>
    );
  } else if (overviewFailed && overview === null) {
    body = (
      <div className="files-state" role="alert">
        <p>{t("files.failed")}</p>
        <button type="button" className="button" onClick={refresh}>
          {t("files.retry")}
        </button>
      </div>
    );
  } else if (nothingYet || location === null) {
    body = (
      <div className="files-empty">
        <FolderIcon size={56} />
        <h2>{t("files.emptyTitle")}</h2>
        <p>{t("files.emptyBody")}</p>
        <button
          type="button"
          className="button primary"
          onClick={() => void addFolder()}
        >
          {t("files.addFolder")}
        </button>
        <p className="files-empty-hint">{t("files.emptyDrop")}</p>
      </div>
    );
  } else if (location.kind === "folder" && folderError !== null) {
    const kind = errorKind(folderError);
    const denied = kind === "fileOutside" || kind === "fileNoAccess";
    const missing = kind === "fileMissing";
    body = (
      <div className="files-state" role="alert">
        <h2>
          {denied
            ? t("files.deniedTitle")
            : missing
              ? t("files.missingTitle")
              : t("files.failed")}
        </h2>
        <p>
          {kind === "fileNoAccess"
            ? t("files.noAccessBody")
            : denied
              ? t("files.deniedBody")
              : missing
                ? t("files.missingBody")
                : null}
        </p>
        <div className="row">
          <button type="button" className="button" onClick={refresh}>
            {t("files.retry")}
          </button>
          {currentPlaceForPath(places, location.path) ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                const place = currentPlaceForPath(places, location.path);
                if (place) void removeFolder(place);
              }}
            >
              {t("files.removeFolder")}
            </button>
          ) : null}
        </div>
      </div>
    );
  } else if (location.kind === "folder" && folder === null) {
    body = (
      <p className="files-state" role="status">
        {t("files.loading")}
      </p>
    );
  } else if (shown.length === 0) {
    const text =
      query.trim() !== ""
        ? searching !== null
          ? t("files.searching")
          : t("files.noMatches", { query: query.trim() })
        : location.kind === "recent"
          ? t("files.recentEmpty")
          : t("files.folderEmpty");
    body = (
      <p className="files-state" role="status">
        {text}
      </p>
    );
  } else {
    body = (
      <FilesEntries
        entries={shown}
        view={view}
        selected={Math.min(selected, shown.length - 1)}
        label={
          location.kind === "recent"
            ? t("files.recent")
            : location.kind === "dropped"
              ? t("files.dropped")
              : (crumbs[crumbs.length - 1]?.name ?? t("files.title"))
        }
        showFolder={location.kind !== "folder" || found !== null}
        listRef={listRef}
        onSelect={setSelected}
        onOpen={openEntry}
        onMenu={entryMenu}
        onKey={onListKey}
        onDragOut={(entry) =>
          void filesApi.startDrag(entry.path).catch(() => {})
        }
      />
    );
  }

  const count = shown.length;
  const status =
    location === null || nothingYet
      ? null
      : [
          t("files.items", { count }),
          folder && folder.omitted > 0 && location.kind === "folder" && !found
            ? t("files.omitted", { shown: folder.entries.length })
            : null,
          found?.truncated ? t("files.searchTruncated") : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div
      className={`files ${preview ? "with-preview" : ""} ${expanded ? "expanded" : ""}`}
      style={{ "--files-preview-width": `${previewWidth}px` } as CSSProperties}
    >
      <nav className="files-sidebar" aria-label={t("files.places")}>
        <h2 className="files-sidebar-title">{t("files.places")}</h2>
        <ul className="files-places">
          {places.map((place) => {
            const active =
              location?.kind === "folder" && folder?.placeId === place.id;
            return (
              <li key={place.id} className="files-place-row">
                <button
                  type="button"
                  className={`files-place ${active ? "active" : ""}`}
                  aria-current={active ? "location" : undefined}
                  title={place.path}
                  disabled={!place.available}
                  onClick={() => go({ kind: "folder", path: place.path })}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    placeMenu(place, event.clientX, event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ContextMenu" ||
                      (event.key === "F10" && event.shiftKey)
                    ) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      placeMenu(place, rect.left + 16, rect.bottom);
                    }
                  }}
                >
                  <FolderIcon size={16} />
                  <span className="files-place-name">{place.name}</span>
                  {place.available ? null : (
                    <span className="files-place-note">
                      {t("files.unavailable")}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="files-icon-button files-place-remove"
                  aria-label={t("files.removeFolderNamed", {
                    name: place.name,
                  })}
                  title={t("files.removeFolder")}
                  onClick={() => void removeFolder(place)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="button files-add"
          onClick={() => void addFolder()}
        >
          {t("files.addFolder")}
        </button>
        <ul className="files-places">
          <li>
            <button
              type="button"
              className={`files-place ${location?.kind === "recent" ? "active" : ""}`}
              aria-current={
                location?.kind === "recent" ? "location" : undefined
              }
              onClick={() => go({ kind: "recent" })}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.5V8l2.5 1.5" />
              </svg>
              <span className="files-place-name">{t("files.recent")}</span>
            </button>
          </li>
          {dropped.length > 0 ? (
            <li>
              <button
                type="button"
                className={`files-place ${location?.kind === "dropped" ? "active" : ""}`}
                aria-current={
                  location?.kind === "dropped" ? "location" : undefined
                }
                onClick={() => go({ kind: "dropped" })}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 2v8M5 7l3 3 3-3M3 13h10" />
                </svg>
                <span className="files-place-name">{t("files.dropped")}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <main
        className="files-main"
        aria-busy={folderLoading || searching !== null}
      >
        <div className="files-toolbar">
          <div className="files-path">
            <button
              type="button"
              className="files-icon-button"
              aria-label={t("files.up")}
              title={t("files.up")}
              disabled={!up}
              onClick={() => up && go({ kind: "folder", path: up.path })}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 13V3M4 7l4-4 4 4" />
              </svg>
            </button>
            <nav aria-label={t("files.breadcrumb")} className="files-crumbs">
              <ol>
                {location?.kind === "folder"
                  ? crumbs.map((crumb, index) => (
                      <li key={crumb.path}>
                        {index === crumbs.length - 1 ? (
                          <span aria-current="page">{crumb.name}</span>
                        ) : (
                          <button
                            type="button"
                            className="files-crumb"
                            onClick={() =>
                              go({ kind: "folder", path: crumb.path })
                            }
                          >
                            {crumb.name}
                          </button>
                        )}
                      </li>
                    ))
                  : location
                    ? [
                        <li key="here">
                          <span aria-current="page">
                            {location.kind === "recent"
                              ? t("files.recent")
                              : t("files.dropped")}
                          </span>
                        </li>,
                      ]
                    : null}
              </ol>
            </nav>
          </div>
          <div className="files-tools">
            <div className="files-search">
              <input
                ref={searchRef}
                type="search"
                className="input"
                value={query}
                placeholder={t("files.searchPlaceholder")}
                aria-label={t("files.search")}
                disabled={location === null}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelected(0);
                    listRef.current?.focus();
                  }
                }}
              />
              <label className="files-check">
                <input
                  type="checkbox"
                  checked={deep}
                  disabled={location?.kind !== "folder"}
                  onChange={(event) => setDeep(event.target.checked)}
                />
                {t("files.searchSubfolders")}
              </label>
              {searching !== null ? (
                <button type="button" className="button" onClick={cancelSearch}>
                  {t("files.cancelSearch")}
                </button>
              ) : null}
            </div>
            <label className="files-sort">
              <span className="sr-only">{t("files.sortBy")}</span>
              <select
                className="input"
                value={sort.key}
                aria-label={t("files.sortBy")}
                onChange={(event) =>
                  changeSort({ ...sort, key: event.target.value as SortKey })
                }
              >
                <option value="name">{t("files.sortName")}</option>
                <option value="modified">{t("files.sortModified")}</option>
                <option value="type">{t("files.sortType")}</option>
                <option value="size">{t("files.sortSize")}</option>
              </select>
            </label>
            <button
              type="button"
              className="files-icon-button"
              aria-label={
                sort.direction === "asc"
                  ? t("files.sortAscending")
                  : t("files.sortDescending")
              }
              title={
                sort.direction === "asc"
                  ? t("files.sortAscending")
                  : t("files.sortDescending")
              }
              onClick={() =>
                changeSort({
                  ...sort,
                  direction: sort.direction === "asc" ? "desc" : "asc",
                })
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {sort.direction === "asc" ? (
                  <path d="M5 13V3M2 6l3-3 3 3M10 4h4M10 8h3M10 12h2" />
                ) : (
                  <path d="M5 3v10M2 10l3 3 3-3M10 4h2M10 8h3M10 12h4" />
                )}
              </svg>
            </button>
            <label className="files-check">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={toggleHidden}
              />
              {t("files.showHidden")}
            </label>
            <fieldset className="files-view-toggle">
              <legend className="sr-only">{t("files.view")}</legend>
              <button
                type="button"
                className="files-icon-button"
                aria-label={t("files.viewList")}
                title={t("files.viewList")}
                aria-pressed={view === "list"}
                onClick={() => setViewMode("list")}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2 4h12M2 8h12M2 12h12" />
                </svg>
              </button>
              <button
                type="button"
                className="files-icon-button"
                aria-label={t("files.viewGrid")}
                title={t("files.viewGrid")}
                aria-pressed={view === "grid"}
                onClick={() => setViewMode("grid")}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="5" height="5" rx="1" />
                  <rect x="9" y="2" width="5" height="5" rx="1" />
                  <rect x="2" y="9" width="5" height="5" rx="1" />
                  <rect x="9" y="9" width="5" height="5" rx="1" />
                </svg>
              </button>
            </fieldset>
            <button
              type="button"
              className="files-icon-button"
              aria-label={t("files.refresh")}
              title={t("files.refresh")}
              onClick={refresh}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={folderLoading ? "spinning" : undefined}
              >
                <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />
              </svg>
            </button>
          </div>
        </div>
        {notice ? (
          <p
            className={`message ${notice.tone === "error" ? "error" : "info"} files-notice`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              className="files-icon-button"
              aria-label={t("files.dismiss")}
              onClick={() => setNotice(null)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </p>
        ) : null}
        <div className="files-body">{body}</div>
        {status ? (
          <p className="files-status" role="status">
            {status}
          </p>
        ) : null}
      </main>

      {preview ? (
        <>
          {expanded ? null : (
            // biome-ignore lint/a11y/useSemanticElements: a draggable divider, not a rule
            <div
              className="files-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("files.resizePreview")}
              aria-valuenow={previewWidth}
              aria-valuemin={PREVIEW_MIN}
              tabIndex={0}
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              onKeyDown={onResizeKey}
            />
          )}
          <aside className="files-preview" aria-label={preview.name}>
            <FilesPreviewPanel
              entry={preview}
              expanded={expanded}
              onToggleExpand={() => setExpanded((value) => !value)}
              onClose={() => {
                setPreview(null);
                setExpanded(false);
              }}
              onOpenExternal={() => openExternal(preview)}
              onSaveCopy={() => saveCopy(preview)}
            />
          </aside>
        </>
      ) : null}

      {menu ? (
        <FilesMenu
          x={menu.x}
          y={menu.y}
          label={menu.label}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** The folder part of a path, for Recent and dropped files. */
function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 0 ? path.slice(0, cut) : "";
}

function isInside(path: string, folder: string): boolean {
  if (path === folder) return true;
  const base =
    folder.endsWith("\\") || folder.endsWith("/")
      ? folder
      : `${folder}${folder.includes("\\") ? "\\" : "/"}`;
  return path.startsWith(base);
}

function currentPlaceForPath(places: Place[], path: string): Place | undefined {
  return places.find((place) => place.path === path);
}
