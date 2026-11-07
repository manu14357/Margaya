import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, PageComment } from "@/types/page";
import PageComments from "./page-comments";
import PageWatchButton from "./page-watch-button";

const m = vi.hoisted(() => ({
  comments: [] as unknown[],
  query: { isPending: false, isError: false },
  subscription: null as { pageId: string; subscribed: boolean } | null,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  toggle: vi.fn(),
  refetch: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
    readOnly,
    placeholder,
  }: {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    placeholder?: string;
  }) =>
    readOnly ? (
      <p>{value}</p>
    ) : (
      <textarea
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ),
}));
vi.mock("@/hooks/queries/page/use-page-comments", () => ({
  usePageComments: () => ({
    ...m.query,
    data: m.query.isPending || m.query.isError ? undefined : m.comments,
    refetch: m.refetch,
  }),
  usePageSubscription: () => ({
    data: m.subscription,
    isPending: false,
  }),
}));
vi.mock("@/hooks/mutations/page/use-page-comment-mutations", () => ({
  useCreatePageComment: () => ({ mutate: m.create, isPending: false }),
  useUpdatePageComment: () => ({ mutate: m.update, isPending: false }),
  useDeletePageComment: () => ({ mutate: m.remove, isPending: false }),
  useTogglePageSubscription: () => ({ mutate: m.toggle, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: m.error },
}));

function comment(overrides: Partial<PageComment> = {}): PageComment {
  return {
    id: "c1",
    pageId: "page_1",
    userId: "u1",
    content: "Looks good",
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
    user: { name: "Ada", image: null },
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

function page(canComment = true, archivedAt: string | null = null): Page {
  return {
    id: "page_1",
    archivedAt,
    capabilities: { canComment },
  } as unknown as Page;
}

beforeEach(() => {
  m.comments = [];
  m.query = { isPending: false, isError: false };
  m.subscription = null;
  for (const fn of [
    m.create,
    m.update,
    m.remove,
    m.toggle,
    m.refetch,
    m.error,
  ]) {
    fn.mockReset();
  }
});
afterEach(cleanup);

describe("PageComments", () => {
  it("shows the empty state and adds a comment", async () => {
    m.create.mockImplementation((_content, options) => options.onSuccess?.());
    render(<PageComments page={page()} />);

    expect(screen.getByText("pages:comments.emptyTitle")).toBeTruthy();
    const box = screen.getByRole("textbox", {
      name: "pages:comments.placeholder",
    });
    const send = screen.getByRole("button", { name: "pages:comments.add" });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(box, { target: { value: "  Hello  " } });
    fireEvent.click(send);
    expect(m.create).toHaveBeenCalledWith("Hello", expect.anything());
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
  });

  it("reports a failed comment and keeps the draft", () => {
    m.create.mockImplementation((_content, options) => options.onError?.());
    render(<PageComments page={page()} />);
    const box = screen.getByRole("textbox", {
      name: "pages:comments.placeholder",
    });
    fireEvent.change(box, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "pages:comments.add" }));

    expect(m.error).toHaveBeenCalledWith("pages:comments.toasts.addError");
    expect((box as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("explains why an archived page takes no comments", () => {
    m.comments = [comment({ canEdit: false, canDelete: false })];
    render(<PageComments page={page(false, "2026-10-10T08:00:00.000Z")} />);

    expect(screen.getByText("Looks good")).toBeTruthy();
    expect(screen.getByText("pages:comments.archivedNote")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("hides the composer from a viewer without a note", () => {
    render(<PageComments page={page(false)} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("pages:comments.archivedNote")).toBeNull();
  });

  it("names a deleted author and hides actions it can't take", () => {
    m.comments = [
      comment({ user: null, userId: null, canEdit: false, canDelete: false }),
    ];
    render(<PageComments page={page()} />);

    expect(screen.getByText("pages:comments.deletedUser")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "pages:comments.menuAria" }),
    ).toBeNull();
  });

  it("marks an edited comment", () => {
    m.comments = [comment({ updatedAt: "2026-10-11T08:00:00.000Z" })];
    render(<PageComments page={page()} />);
    expect(screen.getByText("pages:comments.edited")).toBeTruthy();
  });

  it("edits a comment from its menu", async () => {
    m.comments = [comment()];
    m.update.mockImplementation((_vars, options) => options.onSuccess?.());
    render(<PageComments page={page()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages:comments.menuAria" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "pages:comments.edit" }),
    );
    const [editBox] = screen.getAllByRole("textbox", {
      name: "pages:comments.placeholder",
    });
    if (!editBox) throw new Error("missing edit box");
    expect((editBox as HTMLTextAreaElement).value).toBe("Looks good");
    fireEvent.change(editBox, { target: { value: "Better" } });
    fireEvent.click(
      screen.getByRole("button", { name: "pages:comments.save" }),
    );

    expect(m.update).toHaveBeenCalledWith(
      { commentId: "c1", content: "Better" },
      expect.anything(),
    );
  });

  it("deletes a comment only after confirming", async () => {
    m.comments = [comment()];
    render(<PageComments page={page()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages:comments.menuAria" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "pages:comments.delete" }),
    );
    expect(m.remove).not.toHaveBeenCalled();
    expect(
      await screen.findByText("pages:comments.deleteDescription"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "pages:comments.delete" }),
    );
    expect(m.remove).toHaveBeenCalledWith("c1", expect.anything());
  });

  it("shows the loading and error states", () => {
    m.query = { isPending: false, isError: true };
    const { rerender } = render(<PageComments page={page()} />);
    expect(screen.getByText("pages:comments.loadError")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "pages:comments.retry" }),
    );
    expect(m.refetch).toHaveBeenCalled();

    m.query = { isPending: true, isError: false };
    rerender(<PageComments page={page()} />);
    expect(screen.queryByText("pages:comments.loadError")).toBeNull();
    expect(screen.queryByText("pages:comments.emptyTitle")).toBeNull();
  });
});

describe("PageWatchButton", () => {
  it("offers to watch, and to stop watching", async () => {
    const { TooltipProvider } = await import("@/components/ui/tooltip");
    m.subscription = { pageId: "page_1", subscribed: false };
    const { rerender } = render(
      <TooltipProvider>
        <PageWatchButton pageId="page_1" />
      </TooltipProvider>,
    );

    const watch = screen.getByRole("button", { name: "pages:watch.watch" });
    expect(watch.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(watch);
    expect(m.toggle).toHaveBeenCalledWith(true, expect.anything());

    m.subscription = { pageId: "page_1", subscribed: true };
    rerender(
      <TooltipProvider>
        <PageWatchButton pageId="page_1" />
      </TooltipProvider>,
    );
    const stop = screen.getByRole("button", { name: "pages:watch.unwatch" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(stop);
    expect(m.toggle).toHaveBeenLastCalledWith(false, expect.anything());
  });
});
