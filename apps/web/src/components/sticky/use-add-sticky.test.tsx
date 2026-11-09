import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { stickiesQueryKey } from "@/lib/sticky-cache";
import { isStickyColor } from "@/lib/sticky-colors";
import { focusSticky, useAddSticky } from "./use-add-sticky";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/sticky/use-sticky-mutations", () => ({
  useCreateSticky: () => ({ mutate: mocks.create, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { info: mocks.info, error: mocks.error },
}));

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function seed(queryKey: readonly unknown[], contents: string[]) {
  queryClient.setQueryData(queryKey, {
    pageParams: [null],
    pages: [
      {
        items: contents.map((content, index) => ({
          id: `s-${index}`,
          content,
        })),
        nextCursor: null,
      },
    ],
  });
}

beforeEach(() => {
  queryClient = new QueryClient();
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useAddSticky", () => {
  it("focuses the blank first sticky instead of creating another", () => {
    seed(stickiesQueryKey("ws-1", "", 30), ["", "older note"]);
    const { result } = renderHook(() => useAddSticky("ws-1"), { wrapper });

    act(() => result.current.add());

    expect(mocks.info).toHaveBeenCalledWith("stickies:toast.alreadyEmpty");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores searched lists when looking for the first sticky", () => {
    seed(stickiesQueryKey("ws-1", "note", 30), [""]);
    seed(stickiesQueryKey("ws-1", "", 30), ["has text"]);
    const { result } = renderHook(() => useAddSticky("ws-1"), { wrapper });

    act(() => result.current.add());

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [variables] = mocks.create.mock.calls[0];
    expect(variables.workspaceId).toBe("ws-1");
    expect(isStickyColor(variables.color)).toBe(true);
  });

  it("focuses a new sticky whose editor mounts long after 30 frames", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const runFrame = () => frames.shift()?.(0);
    try {
      focusSticky("late");
      // 100 frames over 1.5 s: still waiting for the editor.
      for (let frame = 0; frame < 100; frame += 1) {
        vi.advanceTimersByTime(15);
        runFrame();
      }
      expect(frames).toHaveLength(1);

      const card = document.createElement("div");
      card.dataset.stickyId = "late";
      card.scrollIntoView = vi.fn();
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      editor.tabIndex = 0;
      card.append(editor);
      document.body.append(card);
      runFrame();
      expect(document.activeElement).toBe(editor);
      card.remove();

      // It gives up after its time budget.
      focusSticky("never");
      vi.advanceTimersByTime(3001);
      runFrame();
      expect(frames).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("focuses the preview standing in for an editor that hasn't loaded", () => {
    const card = document.createElement("div");
    card.dataset.stickyId = "plain";
    card.scrollIntoView = vi.fn();
    const preview = document.createElement("div");
    preview.dataset.stickyPreview = "";
    preview.tabIndex = 0;
    // An editor mounting behind the preview comes later in the card.
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 0;
    card.append(preview, editor);
    document.body.append(card);
    try {
      focusSticky("plain");
      expect(document.activeElement).toBe(preview);
    } finally {
      card.remove();
    }
  });

  it("toasts the cap on a 409 and a generic error otherwise", () => {
    const { result } = renderHook(() => useAddSticky("ws-1"), { wrapper });
    act(() => result.current.add());
    const [, options] = mocks.create.mock.calls[0];

    options.onError(new HttpError(409, "cap"));
    options.onError(new Error("boom"));
    expect(mocks.error.mock.calls.map(([message]) => message)).toEqual([
      "stickies:toast.limit",
      "stickies:toast.createError",
    ]);
  });
});
