import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StickyCard from "./sticky-card";
import type { StickyEditorHandle } from "./sticky-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  mutate: vi.fn(),
  remove: vi.fn(async () => ({})),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  commentEditorLoaded: vi.fn(),
  stickyEditorLoaded: vi.fn(),
  focus: vi.fn(),
  placeCaret: vi.fn(),
  applyEdits: vi.fn(),
  // The real editor gets ready a task or more after it mounts; tests that
  // act on the preview meanwhile hold readiness and release it themselves.
  autoReady: true,
  release: null as null | (() => void),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Loading the comment editor is what Home must not do up front.
vi.mock("@/components/activity/comment-editor", () => {
  mocks.commentEditorLoaded();
  return { default: () => null };
});
// The TipTap editor is out of scope here: a textarea stands in for it, with
// a handle that records what the card hands over.
vi.mock("./sticky-editor", async () => {
  mocks.stickyEditorLoaded();
  const { useEffect, useRef } = await import("react");
  function FakeStickyEditor({
    value,
    onChange,
    onReady,
  }: {
    value: string;
    onChange: (value: string) => void;
    onReady: (handle: StickyEditorHandle) => void;
  }) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
      const textarea = ref.current as HTMLTextAreaElement;
      const ready = () =>
        onReady({
          isSettled: () => true,
          hasFocus: () => document.activeElement === textarea,
          placeCaret: mocks.placeCaret,
          focus: (target) => {
            mocks.focus(target);
            textarea.focus();
          },
          applyEdits: (toggles, keys) => {
            mocks.applyEdits(new Map(toggles), [...keys]);
            const typed = keys
              .map((key) => ("text" in key ? key.text : ""))
              .join("");
            if (typed) onChange(textarea.value + typed);
          },
        });
      if (mocks.autoReady) ready();
      else mocks.release = ready;
    }, []);
    return (
      <textarea
        ref={ref}
        aria-label="editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return { default: FakeStickyEditor };
});
vi.mock("@/hooks/mutations/sticky/use-sticky-mutations", () => ({
  useUpdateSticky: () => ({ mutateAsync: mocks.save, mutate: mocks.mutate }),
  useDeleteSticky: () => ({ mutateAsync: mocks.remove }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

function sticky(content: string) {
  return {
    id: "s-1",
    workspaceId: "ws-1",
    content,
    color: "yellow" as const,
    position: 0,
    createdAt: "",
    updatedAt: "",
  };
}

function renderCard(content = "") {
  return render(<StickyCard sticky={sticky(content)} workspaceId="ws-1" />);
}

const editor = () => screen.getByLabelText("editor") as HTMLTextAreaElement;
const preview = () => screen.getByRole("textbox");

/** Focuses the preview and waits for the editor to take the focus over. */
async function startEditing() {
  vi.useRealTimers();
  act(() => preview().focus());
  await waitFor(() => expect(document.activeElement).toBe(editor()));
  vi.useFakeTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.save.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.autoReady = true;
  mocks.release = null;
});

/** Lets the held-back editor report ready. */
async function releaseEditor() {
  await waitFor(() => expect(mocks.release).not.toBeNull());
  act(() => mocks.release?.());
}

// First in the file: the editor modules load once per file.
describe("StickyCard on demand", () => {
  it("shows stored text without loading the editor, and loads it on focus", async () => {
    vi.useRealTimers();
    renderCard("- [ ] Buy milk\n- [x] Call mum");
    expect(preview()).toHaveTextContent("Buy milkCall mum");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByLabelText("editor")).toBeNull();
    expect(mocks.commentEditorLoaded).not.toHaveBeenCalled();
    expect(mocks.stickyEditorLoaded).not.toHaveBeenCalled();

    act(() => preview().focus());
    await waitFor(() => expect(document.activeElement).toBe(editor()));
    expect(mocks.stickyEditorLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.focus).toHaveBeenCalledWith("text");
    // The preview is gone; the editor shows in its place.
    expect(screen.getByRole("textbox")).toBe(editor());
    expect(editor().closest("[inert]")).toBeNull();
  });

  it("keeps keys typed before the editor shows, away from page shortcuts", async () => {
    vi.useRealTimers();
    const onPageKey = vi.fn();
    document.addEventListener("keydown", onPageKey);
    try {
      mocks.autoReady = false;
      renderCard("Note");
      const root = preview();
      act(() => root.focus());
      fireEvent.keyDown(root, { key: "!" });
      fireEvent.keyDown(root, { key: "Enter" });
      fireEvent.keyDown(root, { key: "Backspace" });
      fireEvent.keyDown(root, { key: "ArrowDown" });
      expect(document.activeElement).toBe(root);
      await releaseEditor();
      await waitFor(() => expect(document.activeElement).toBe(editor()));
      expect(mocks.applyEdits).toHaveBeenCalledWith(new Map(), [
        { text: "!" },
        { key: "Enter" },
        { key: "Backspace" },
      ]);
      expect(onPageKey).toHaveBeenCalledTimes(1);
      expect(onPageKey.mock.calls[0][0].key).toBe("ArrowDown");
      await waitFor(() =>
        expect(mocks.save).toHaveBeenCalledWith({
          workspaceId: "ws-1",
          stickyId: "s-1",
          changes: { content: "Note!" },
        }),
      );
    } finally {
      document.removeEventListener("keydown", onPageKey);
    }
  });

  it("puts the caret where the preview was clicked", async () => {
    vi.useRealTimers();
    mocks.autoReady = false;
    renderCard("Note");
    const root = preview();
    root.getBoundingClientRect = () => new DOMRect(100, 200, 300, 120);
    fireEvent.pointerDown(root, { button: 0, clientX: 130, clientY: 215 });
    act(() => root.focus());
    fireEvent.pointerUp(root);
    await releaseEditor();
    await waitFor(() => expect(document.activeElement).toBe(editor()));
    expect(mocks.placeCaret).toHaveBeenCalledWith({ x: 30, y: 15 }, 0);
  });

  // The editor's code is already loaded (another sticky was edited): it is
  // ready within the press, before the press has focused anything.
  it("with the editor loaded, waits for the press to focus the text", async () => {
    vi.useRealTimers();
    renderCard("Note");
    const root = preview();
    fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    // Still held: the preview stays, so the press can focus it.
    expect(preview()).toBe(root);
    act(() => root.focus());
    fireEvent.pointerUp(root);
    await waitFor(() => expect(document.activeElement).toBe(editor()));
    expect(mocks.focus).toHaveBeenCalledWith("text");
  });

  it("with the editor loaded, a tick on a to-do still counts", async () => {
    vi.useRealTimers();
    renderCard("- [ ] Buy milk\n- [ ] Call mum");
    const first = screen.getAllByRole("checkbox")[0];
    fireEvent.pointerDown(first, { button: 0 });
    act(() => first.focus());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    fireEvent.pointerUp(first);
    fireEvent.click(first);
    await waitFor(() =>
      expect(mocks.applyEdits).toHaveBeenCalledWith(new Map([[0, true]]), []),
    );
    expect(mocks.focus).toHaveBeenCalledWith({ checkbox: 0 });
  });

  it("applies a to-do ticked before the editor shows and keeps focus on it", async () => {
    vi.useRealTimers();
    mocks.autoReady = false;
    renderCard("- [ ] Buy milk\n- [ ] Call mum");
    const second = screen.getAllByRole("checkbox")[1];
    act(() => second.focus());
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-checked", "true");
    await releaseEditor();
    await waitFor(() => expect(mocks.applyEdits).toHaveBeenCalled());
    expect(mocks.applyEdits).toHaveBeenCalledWith(new Map([[1, true]]), []);
    expect(mocks.focus).toHaveBeenCalledWith({ checkbox: 1 });
  });

  it("mounts the editor at once for text only it can draw", async () => {
    vi.useRealTimers();
    renderCard("**Bold** plan");
    await waitFor(() => expect(editor().closest("[inert]")).toBeNull());
    expect(screen.queryAllByRole("textbox")).toEqual([editor()]);
    // Nothing had focus, so nothing takes it.
    expect(mocks.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("StickyCard autosave", () => {
  it("sends one PATCH 800 ms after the last change", async () => {
    renderCard();
    await startEditing();
    fireEvent.change(editor(), { target: { value: "a" } });
    await act(async () => vi.advanceTimersByTime(500));
    fireEvent.change(editor(), { target: { value: "ab" } });
    await act(async () => vi.advanceTimersByTime(799));
    expect(mocks.save).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      stickyId: "s-1",
      changes: { content: "ab" },
    });
  });

  it("never saves a change the editor reports without focus", async () => {
    vi.useRealTimers();
    // Text only the editor draws, so it mounts without anyone focusing it.
    renderCard("**Stored** note");
    await waitFor(() => expect(editor().closest("[inert]")).toBeNull());
    // An editor loading its content reports the empty document first.
    fireEvent.change(editor(), { target: { value: "" } });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    cleanup();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("flushes at once on blur", async () => {
    renderCard();
    await startEditing();
    fireEvent.change(editor(), { target: { value: "note" } });
    await act(async () => {
      fireEvent.blur(editor());
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft while focused and adopts server content after blur", async () => {
    const { rerender } = renderCard("mine");
    await startEditing();
    rerender(<StickyCard sticky={sticky("theirs")} workspaceId="ws-1" />);
    expect(editor().value).toBe("mine");

    await act(async () => {
      fireEvent.blur(editor());
    });
    expect(editor().value).toBe("theirs");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("shows the footer retry after a failed save and toasts once", async () => {
    mocks.save.mockRejectedValue(new Error("offline"));
    renderCard();
    await startEditing();
    fireEvent.change(editor(), { target: { value: "x" } });
    await act(async () => vi.advanceTimersByTime(800));

    expect(screen.getByText("stickies:status.saveFailed")).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText("stickies:status.retry"));
    });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});

describe("StickyCard delete", () => {
  it("deletes a blank sticky without asking and confirms once it's gone", async () => {
    const { unmount } = renderCard("- [ ] ");
    fireEvent.click(screen.getByLabelText("stickies:delete.button"));
    expect(mocks.remove).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      stickyId: "s-1",
    });
    expect(screen.queryByText("stickies:delete.title")).toBeNull();

    // The optimistic delete removes the card before the request settles.
    unmount();
    await act(async () => {});
    expect(mocks.toastSuccess).toHaveBeenCalledWith("stickies:toast.deleted");
  });

  it("asks before deleting a sticky with text", async () => {
    vi.useRealTimers();
    renderCard("keep me");
    fireEvent.click(screen.getByLabelText("stickies:delete.button"));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(
      await screen.findByText("stickies:delete.title"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
