import {
  type BoardElement,
  createElement,
  parseBoardFile,
  readElements,
  writeElements,
} from "@margaya/whiteboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardController } from "./controller";
import { LOCAL_ORIGIN } from "./scene";
import type { WhiteboardEditorHandle, WhiteboardEditorProps } from "./types";
import { WhiteboardEditor } from "./whiteboard-editor";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "loading-toast"),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast }));
vi.mock("@/fetchers/task/get-tasks", () => ({
  default: vi.fn(async () => ({
    id: "p1",
    slug: "WEB",
    columns: [
      {
        id: "c1",
        name: "To do",
        slug: "to-do",
        isFinal: false,
        tasks: [
          {
            id: "t1",
            title: "Write docs",
            number: 4,
            status: "to-do",
            priority: "high",
          },
        ],
      },
    ],
    archivedTasks: [],
    plannedTasks: [],
  })),
}));
vi.mock("@/fetchers/column/get-columns", () => ({
  default: vi.fn(async () => []),
}));
vi.mock("@/fetchers/task/get-task", () => ({
  default: vi.fn(async () => null),
}));

beforeAll(() => {
  // jsdom has no canvas; the renderer simply gets no context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

afterEach(() => {
  cleanup();
  toast.success.mockClear();
  toast.error.mockClear();
  toast.info.mockClear();
  toast.loading.mockClear();
  toast.dismiss.mockClear();
});

function mount(
  overrides: Partial<WhiteboardEditorProps> = {},
  elements: BoardElement[] = [createElement("rectangle")],
  { strict = false } = {},
) {
  const doc = new Y.Doc();
  writeElements(doc, elements, "seed");
  let handle: WhiteboardEditorHandle | null = null;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  render(
    <WhiteboardEditor
      doc={doc}
      awareness={null}
      readOnly={false}
      user={{ id: "me", name: "Me", color: "#2563eb" }}
      workspaceId="w1"
      projectId="p1"
      whiteboardId="b1"
      theme="light"
      imageUrl={(id) => `/assets/${id}`}
      onReady={(next) => {
        handle = next;
      }}
      {...overrides}
    />,
    { wrapper },
  );
  return { doc, handle: () => handle as WhiteboardEditorHandle | null };
}

describe("WhiteboardEditor", () => {
  it("shows the tools and hands the screen an export handle", async () => {
    const { handle } = mount();
    expect(screen.getByTestId("whiteboard-tool-shape")).toBeTruthy();
    expect(screen.getByTestId("whiteboard-tool-sticky")).toBeTruthy();
    const file = await handle()?.exportFile();
    expect(file && parseBoardFile(file)?.elements).toHaveLength(1);
  });

  it("titles unnamed frames in the viewer's language, in exports and on public boards too", async () => {
    const unnamed = createElement("frame", { name: "" });
    const named = createElement("frame", { name: "Sprint", x: 600 });
    const title = ">whiteboardEditor:tools.frame</text>";
    const { handle } = mount({}, [unnamed, named]);
    const svg = (await handle()?.exportSvg()) ?? "";
    expect(svg).toContain(title);
    expect(svg).toContain(">Sprint</text>");
    expect(svg.split(title)).toHaveLength(2);
    cleanup();
    const { handle: publicHandle } = mount({ readOnly: true, isPublic: true }, [
      unnamed,
    ]);
    expect((await publicHandle()?.exportSvg()) ?? "").toContain(title);
  });

  it("offers only viewing tools on a read-only board", () => {
    mount({ readOnly: true });
    expect(screen.getByTestId("whiteboard-tool-select")).toBeTruthy();
    expect(screen.getByTestId("whiteboard-tool-hand")).toBeTruthy();
    expect(screen.queryByTestId("whiteboard-tool-shape")).toBeNull();
    expect(screen.queryByTestId("whiteboard-undo")).toBeNull();
  });

  it("picks tools from the keyboard", () => {
    mount();
    const editor = screen.getByTestId("whiteboard-editor");
    act(() => {
      fireEvent.keyDown(window, { key: "r", code: "KeyR" });
    });
    expect(editor.dataset.tool).toBe("rectangle");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(editor.dataset.tool).toBe("select");
  });

  it("opens the shape library with Shift+S and draws the pick", () => {
    mount();
    const editor = screen.getByTestId("whiteboard-editor");
    act(() => {
      fireEvent.keyDown(window, { key: "S", code: "KeyS", shiftKey: true });
    });
    expect(screen.getByTestId("whiteboard-shape-picker")).toBeTruthy();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "whiteboardEditor:shapes.names.cloud",
        }),
      );
    });
    expect(editor.dataset.tool).toBe("shape");
    expect(
      screen.getByTestId("whiteboard-tool-shape").getAttribute("aria-label"),
    ).toBe("whiteboardEditor:shapes.names.cloud");
  });

  it("shows the background control only on a writable board", () => {
    mount();
    expect(screen.getByTestId("whiteboard-background-button")).toBeTruthy();
    cleanup();
    mount({ readOnly: true });
    expect(screen.queryByTestId("whiteboard-background-button")).toBeNull();
  });

  it("refuses keyboard edits on a read-only board", () => {
    const rect = createElement("rectangle");
    const { doc } = mount({ readOnly: true }, [rect]);
    act(() => {
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(readElements(doc)).toHaveLength(1);
  });

  it("says a board is read-only once for a burst of refused keys", () => {
    mount({ readOnly: true });
    act(() => {
      for (const key of ["Delete", "Delete", "Enter"])
        fireEvent.keyDown(window, { key });
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "whiteboardEditor:notices.readOnly",
    );
  });

  it("aligns with Ctrl+Shift+arrow while a plain button has focus", () => {
    const left = createElement("rectangle", { x: 0, y: 0 });
    const right = createElement("rectangle", { x: 300, y: 40 });
    const { doc } = mount({}, [left, right]);
    act(() => {
      fireEvent.keyDown(window, { key: "a", code: "KeyA", ctrlKey: true });
    });
    const zoomIn = screen.getByRole("button", {
      name: "whiteboardEditor:zoom.in",
    });
    zoomIn.focus();
    act(() => {
      fireEvent.keyDown(zoomIn, {
        key: "ArrowLeft",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    expect(readElements(doc).map((element) => element.x)).toEqual([0, 0]);
  });

  it("places a dropped PNG without a board in it as an image, quietly", async () => {
    const uploadImage = vi.fn(async () => ({
      assetId: "a1",
      width: 10,
      height: 10,
    }));
    const { doc } = mount({ uploadImage }, []);
    const png = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "photo.png",
      {
        type: "image/png",
      },
    );
    await act(async () => {
      fireEvent.drop(screen.getByTestId("whiteboard-editor"), {
        dataTransfer: { files: [png], getData: () => "" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(readElements(doc)).toHaveLength(1));
    expect(uploadImage).toHaveBeenCalledWith(png);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("takes the uploading toast down when the upload ends, and shows an error when it fails", async () => {
    const png = () =>
      new File([new Uint8Array([137, 80, 78, 71])], "photo.png", {
        type: "image/png",
      });
    const drop = async (file: File) => {
      await act(async () => {
        fireEvent.drop(screen.getByTestId("whiteboard-editor"), {
          dataTransfer: { files: [file], getData: () => "" },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const { doc } = mount(
      {
        uploadImage: vi.fn(async () => ({
          assetId: "a1",
          width: 10,
          height: 10,
        })),
      },
      [],
    );
    await drop(png());
    await vi.waitFor(() => expect(readElements(doc)).toHaveLength(1));
    expect(toast.loading).toHaveBeenCalledWith(
      "whiteboardEditor:notices.uploading",
    );
    expect(toast.dismiss).toHaveBeenCalledWith("loading-toast");
    expect(toast.error).not.toHaveBeenCalled();

    cleanup();
    toast.loading.mockClear();
    toast.dismiss.mockClear();
    mount(
      {
        uploadImage: vi.fn(async () => {
          throw new Error("storage down");
        }),
      },
      [],
    );
    await drop(png());
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "whiteboardEditor:notices.uploadFailed",
      ),
    );
    expect(toast.dismiss).toHaveBeenCalledWith("loading-toast");
    expect(toast.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      toast.error.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("refuses a dropped file that is not a picture the board can hold", async () => {
    const uploadImage = vi.fn();
    const { doc } = mount({ uploadImage }, []);
    const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.drop(screen.getByTestId("whiteboard-editor"), {
        dataTransfer: { files: [pdf], getData: () => "" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(uploadImage).not.toHaveBeenCalled();
    expect(readElements(doc)).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("whiteboards:toasts.imageType");
  });

  it("keeps following the document in strict mode", async () => {
    const { doc, handle } = mount({}, [], { strict: true });
    act(() => {
      writeElements(doc, [createElement("sticky", { text: "Live" })], "remote");
    });
    const file = await handle()?.exportFile();
    expect(file && parseBoardFile(file)?.elements).toHaveLength(1);
  });

  describe("first view", () => {
    afterEach(() => vi.restoreAllMocks());

    function withSize() {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ width: 800, height: 600 }),
      );
      return vi.spyOn(BoardController.prototype, "zoomToFit");
    }

    it("frames a board's content when it arrives", () => {
      const fit = withSize();
      const { doc } = mount({}, []);
      expect(fit).not.toHaveBeenCalled();
      act(() => {
        writeElements(doc, [createElement("rectangle")], "remote");
      });
      expect(fit).toHaveBeenCalledTimes(1);
    });

    it("leaves the view alone when the first shape is drawn here", () => {
      const fit = withSize();
      const { doc } = mount({}, []);
      act(() => {
        writeElements(doc, [createElement("rectangle")], LOCAL_ORIGIN);
      });
      act(() => {
        writeElements(doc, [createElement("ellipse")], "remote");
      });
      expect(fit).not.toHaveBeenCalled();
    });

    it("leaves the view alone when a collaborator draws on a board that synced empty", () => {
      const fit = withSize();
      const { doc } = mount({ synced: true }, []);
      act(() => {
        writeElements(doc, [createElement("rectangle")], "remote");
      });
      expect(fit).not.toHaveBeenCalled();
    });

    it("still frames content that is already there once synced", () => {
      const fit = withSize();
      mount({ synced: true }, [createElement("rectangle")]);
      expect(fit).toHaveBeenCalledTimes(1);
    });
  });

  it("imports a board file through the handle", async () => {
    const { doc, handle } = mount({}, []);
    const source = createElement("sticky", { text: "Imported" });
    const body = JSON.stringify({
      type: "margaya-board",
      version: 1,
      elements: [source],
      settings: {},
    });
    const file = new File([body], "plan.margaya-board", {
      type: "application/json",
    });
    await act(async () => {
      await handle()?.importFile(file);
    });
    const elements = readElements(doc);
    expect(elements).toHaveLength(1);
    // Imported elements get fresh ids so a second import cannot clash.
    expect(elements[0]?.id).not.toBe(source.id);
    expect(elements[0]?.type === "sticky" && elements[0].text).toBe("Imported");
  });
});

describe("WhiteboardEditor present mode", () => {
  const frames: BoardElement[] = [
    createElement("frame", { id: "f2", x: 600, y: 0, width: 400, height: 300 }),
    createElement("frame", { id: "f1", x: 0, y: 0, width: 400, height: 300 }),
  ];

  it("hides the toolbars, steps through frames and exits on Esc", () => {
    const onExitPresent = vi.fn();
    mount({ presenting: true, onExitPresent }, frames);
    expect(screen.queryByTestId("whiteboard-tool-shape")).toBeNull();
    expect(screen.getByTestId("whiteboard-present")).toBeTruthy();
    const previous = screen.getByRole("button", {
      name: "whiteboards:present.previous",
    }) as HTMLButtonElement;
    const next = screen
      .getAllByRole("button", { name: "whiteboards:present.next" })
      .find((button) => button.tabIndex !== -1) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(previous.disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExitPresent).toHaveBeenCalledTimes(1);
  });

  it("shows only the exit control on a board without frames", () => {
    mount({ presenting: true });
    expect(
      screen.queryByRole("button", { name: "whiteboards:present.previous" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "whiteboards:present.exit" }),
    ).toBeTruthy();
  });
});
