import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StickyCard from "./sticky-card";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  mutate: vi.fn(),
  remove: vi.fn(async () => ({})),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The TipTap editor is out of scope here: a textarea stands in for it.
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
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

beforeEach(() => {
  vi.useFakeTimers();
  mocks.save.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("StickyCard autosave", () => {
  it("sends one PATCH 800 ms after the last change", async () => {
    renderCard();
    fireEvent.focus(editor());
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
    renderCard("Stored note");
    // An editor loading its content reports the empty document first.
    fireEvent.change(editor(), { target: { value: "" } });
    await act(async () => vi.advanceTimersByTime(2000));
    cleanup();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("flushes at once on blur", async () => {
    renderCard();
    fireEvent.focus(editor());
    fireEvent.change(editor(), { target: { value: "note" } });
    await act(async () => {
      fireEvent.blur(editor());
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft while focused and adopts server content after blur", async () => {
    const { rerender } = renderCard("mine");
    fireEvent.focus(editor());
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
    fireEvent.focus(editor());
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
