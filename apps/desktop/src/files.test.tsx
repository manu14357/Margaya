import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Files, SEARCH_DELAY_MS } from "./files";
import type { FileEntry, FilesOverview, FolderView } from "./lib/files-api";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

// The shared preview: the test only checks what the window hands it.
const previewProps = vi.fn();
vi.mock("@margaya/file-preview", () => ({
  DEFAULT_LABELS: { download: "Download", loading: "Loading preview…" },
  FileTypeIcon: ({ name }: { name: string }) => (
    <span data-testid="type-icon">{name.split(".").pop()}</span>
  ),
  FilePreview: (props: {
    source: { name: string; url?: string };
    onDownload?: () => void;
    onOpenExternal?: () => void;
    toolbarEnd?: React.ReactNode;
  }) => {
    previewProps(props);
    return (
      <div data-testid="preview">
        <span>preview:{props.source.name}</span>
        {props.source.url ? <span>url:{props.source.url}</span> : null}
        <button type="button" onClick={props.onDownload}>
          download
        </button>
        <button type="button" onClick={props.onOpenExternal}>
          external
        </button>
        {props.toolbarEnd}
      </div>
    );
  },
}));

const ROOT = "C:\\Users\\me\\Docs";

function entry(
  name: string,
  kind: FileEntry["kind"],
  size: number | null,
  modified: number,
): FileEntry {
  return {
    name,
    path: `${ROOT}\\${name}`,
    kind,
    size,
    modified,
    hidden: name.startsWith("."),
    link: false,
  };
}

const place = { id: "p1", name: "Docs", path: ROOT, available: true };
const withPlace: FilesOverview = { places: [place], recent: [] };

function folderView(path: string, entries: FileEntry[]): FolderView {
  const parts = path.slice(ROOT.length).split("\\").filter(Boolean);
  let current = ROOT;
  const crumbs = [{ name: "Docs", path: ROOT }];
  for (const part of parts) {
    current = `${current}\\${part}`;
    crumbs.push({ name: part, path: current });
  }
  return { path, placeId: "p1", crumbs, entries, omitted: 0 };
}

const rootEntries = [
  entry("zeta.pdf", "file", 5_000, 3),
  entry("Projects", "folder", null, 1),
  entry("alpha.md", "file", 90_000, 2),
  entry("clip.mp4", "file", 2_000_000, 4),
  entry(".secret", "file", 10, 5),
];
const projectEntries = [entry("plan.xlsx", "file", 100, 1)];

function setup(
  overrides: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      if (overrides[command]) return overrides[command](args);
      switch (command) {
        case "files_overview":
          return withPlace;
        case "files_list":
          return args.path === ROOT
            ? folderView(ROOT, rootEntries)
            : folderView(String(args.path), projectEntries);
        case "files_read":
          return new ArrayBuffer(4);
        case "files_stream_url":
          return "http://margaya-file.localhost/abc";
        case "files_save_copy":
          return "C:\\Users\\me\\Desktop\\zeta.pdf";
        default:
          return undefined;
      }
    },
  );
}

function options() {
  return within(screen.getByRole("listbox")).getAllByRole("option");
}

function names() {
  return options().map(
    (option) => option.querySelector(".files-entry-name")?.textContent,
  );
}

function calls(command: string) {
  return invoke.mock.calls.filter(([name]) => name === command);
}

describe("Files", () => {
  beforeEach(() => {
    invoke.mockReset();
    previewProps.mockReset();
    listeners.clear();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("asks for a folder when there is none yet, then shows it", async () => {
    let added = false;
    setup({
      files_overview: () => (added ? withPlace : { places: [], recent: [] }),
      files_add_folder: () => {
        added = true;
        return "p1";
      },
    });
    render(<Files />);
    expect(await screen.findByText("files.emptyTitle")).toBeTruthy();
    expect(screen.getByText("files.emptyDrop")).toBeTruthy();
    const [button] = screen.getAllByRole("button", { name: "files.addFolder" });
    fireEvent.click(button as HTMLElement);
    await vi.waitFor(() => expect(names()).toContain("alpha.md"));
    expect(invoke).toHaveBeenCalledWith("files_list", { path: ROOT });
  });

  it("lists folders first, hides hidden items, and sorts", async () => {
    setup();
    render(<Files />);
    await vi.waitFor(() => expect(options().length).toBe(4));
    expect(names()).toEqual(["Projects", "alpha.md", "clip.mp4", "zeta.pdf"]);

    fireEvent.change(screen.getByRole("combobox", { name: "files.sortBy" }), {
      target: { value: "size" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "files.sortAscending" }),
    );
    expect(names()).toEqual(["Projects", "clip.mp4", "alpha.md", "zeta.pdf"]);
    expect(window.localStorage.getItem("margaya.files.sort")).toBe("size:desc");

    fireEvent.click(screen.getByRole("checkbox", { name: "files.showHidden" }));
    expect(names()).toContain(".secret");
  });

  it("switches between list and grid and remembers it", async () => {
    setup();
    const { container } = render(<Files />);
    await screen.findByRole("listbox");
    expect(container.querySelector(".files-entries.list")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "files.viewGrid" }));
    expect(container.querySelector(".files-entries.grid")).toBeTruthy();
    expect(window.localStorage.getItem("margaya.files.view")).toBe("grid");
    cleanup();
    render(<Files />);
    await screen.findByRole("listbox");
    expect(document.querySelector(".files-entries.grid")).toBeTruthy();
  });

  it("filters the folder by name and searches subfolders on request", async () => {
    setup({
      files_search: () => ({
        entries: [{ ...projectEntries[0], folder: "Projects" }],
        truncated: false,
        cancelled: false,
      }),
    });
    render(<Files />);
    await screen.findByRole("listbox");
    const search = screen.getByRole("searchbox", { name: "files.search" });
    fireEvent.change(search, { target: { value: "ALP" } });
    expect(names()).toEqual(["alpha.md"]);
    fireEvent.change(search, { target: { value: "plan" } });
    expect(screen.getByText("files.noMatches")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "files.searchSubfolders" }),
    );
    await vi.waitFor(() => expect(names()).toEqual(["plan.xlsx"]), {
      timeout: SEARCH_DELAY_MS * 10,
    });
    const [[, args]] = calls("files_search") as [
      [string, Record<string, unknown>],
    ];
    expect(args).toMatchObject({
      path: ROOT,
      query: "plan",
      includeHidden: false,
    });
    expect(screen.getByRole("listbox").textContent).toContain("Projects");
  });

  it("moves with the keyboard: arrows, Enter into a folder, Backspace back up, Delete does nothing", async () => {
    setup();
    render(<Files />);
    await screen.findByRole("listbox");
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    const before = invoke.mock.calls.length;
    fireEvent.keyDown(list, { key: "Delete" });
    expect(invoke.mock.calls.length).toBe(before);

    fireEvent.keyDown(list, { key: "Enter" });
    await vi.waitFor(() => expect(names()).toEqual(["plan.xlsx"]));
    expect(invoke).toHaveBeenCalledWith("files_list", {
      path: `${ROOT}\\Projects`,
    });
    expect(
      screen.getByRole("navigation", { name: "files.breadcrumb" }).textContent,
    ).toContain("Projects");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Backspace" });
    await vi.waitFor(() => expect(names()).toContain("alpha.md"));
  });

  it("previews a file from bytes and remembers it in Recent", async () => {
    setup();
    render(<Files />);
    await screen.findByRole("listbox");
    const option = options().find((item) =>
      item.textContent?.includes("zeta.pdf"),
    );
    fireEvent.doubleClick(option as HTMLElement);
    expect(await screen.findByText("preview:zeta.pdf")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("files_recent_add", {
      path: `${ROOT}\\zeta.pdf`,
    });
    const source = previewProps.mock.calls.at(-1)?.[0].source;
    expect(source.url).toBeUndefined();
    await source.load(new AbortController().signal);
    expect(invoke).toHaveBeenCalledWith("files_read", {
      path: `${ROOT}\\zeta.pdf`,
    });

    fireEvent.click(screen.getByRole("button", { name: "download" }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("files_save_copy", {
        path: `${ROOT}\\zeta.pdf`,
      }),
    );
    expect(await screen.findByText("files.saved")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "files.expandPreview" }),
    );
    expect(document.querySelector(".files.expanded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "files.closePreview" }));
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("streams audio and video instead of reading them whole", async () => {
    setup();
    render(<Files />);
    await screen.findByRole("listbox");
    const option = options().find((item) =>
      item.textContent?.includes("clip.mp4"),
    );
    fireEvent.doubleClick(option as HTMLElement);
    expect(
      await screen.findByText("url:http://margaya-file.localhost/abc"),
    ).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("files_stream_url", {
      path: `${ROOT}\\clip.mp4`,
    });
    expect(calls("files_read")).toHaveLength(0);
  });

  it("offers file actions in a context menu", async () => {
    setup({
      files_open: () => {
        throw { kind: "fileRunsCode", message: "runs code" };
      },
    });
    render(<Files />);
    await screen.findByRole("listbox");
    const option = options().find((item) =>
      item.textContent?.includes("zeta.pdf"),
    );
    fireEvent.contextMenu(option as HTMLElement, { clientX: 20, clientY: 30 });
    const menu = screen.getByRole("menu", { name: "files.menu" });
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "files.previewAction",
      "files.openDefault",
      "files.showInFolder",
      "files.copyPath",
      "files.saveCopy",
      "files.addRecent",
    ]);
    expect(document.activeElement?.textContent).toBe("files.previewAction");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("files.openDefault");

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "files.copyPath" }),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("files_copy_path", {
        path: `${ROOT}\\zeta.pdf`,
      }),
    );

    fireEvent.contextMenu(option as HTMLElement, { clientX: 20, clientY: 30 });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "files.showInFolder" }),
    );
    expect(invoke).toHaveBeenCalledWith("files_reveal", {
      path: `${ROOT}\\zeta.pdf`,
    });

    fireEvent.contextMenu(option as HTMLElement, { clientX: 20, clientY: 30 });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "files.openDefault" }),
    );
    expect(await screen.findByText("files.runsCode")).toBeTruthy();

    fireEvent.contextMenu(option as HTMLElement, { clientX: 20, clientY: 30 });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("removes a place from its context menu", async () => {
    let removed = false;
    setup({
      files_overview: () => (removed ? { places: [], recent: [] } : withPlace),
      files_remove_folder: () => {
        removed = true;
      },
    });
    render(<Files />);
    await screen.findByRole("listbox");
    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }), {
      clientX: 5,
      clientY: 5,
    });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "files.removeFolder" }),
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("files_remove_folder", { id: "p1" }),
    );
    expect(await screen.findByText("files.emptyTitle")).toBeTruthy();
  });

  it("says when a folder can't be read", async () => {
    setup({
      files_list: () => {
        throw { kind: "fileOutside", message: "outside" };
      },
    });
    render(<Files />);
    expect(await screen.findByText("files.deniedTitle")).toBeTruthy();
    expect(screen.getByText("files.deniedBody")).toBeTruthy();
  });

  it("previews files dropped on the window", async () => {
    setup();
    render(<Files />);
    await screen.findByRole("listbox");
    const dropped = {
      ...entry("drop.csv", "file", 12, 9),
      path: "D:\\inbox\\drop.csv",
    };
    await act(async () => {
      listeners.get("files-dropped")?.({
        payload: { files: [dropped], places: 0, refused: 1 },
      });
    });
    expect(await screen.findByText("preview:drop.csv")).toBeTruthy();
    expect(names()).toEqual(["drop.csv"]);
    expect(screen.getByText("files.droppedRefused")).toBeTruthy();
  });

  it("starts a native drag when a file is pulled out", async () => {
    setup();
    render(<Files />);
    await screen.findByRole("listbox");
    const option = options().find((item) =>
      item.textContent?.includes("alpha.md"),
    ) as HTMLElement;
    fireEvent.pointerDown(option, {
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(option, { buttons: 1, clientX: 30, clientY: 12 });
    expect(invoke).toHaveBeenCalledWith("files_start_drag", {
      path: `${ROOT}\\alpha.md`,
    });
  });
});
