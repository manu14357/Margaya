import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommentThread, {
  COLLAPSED_REPLY_COUNT,
  useReplyComposer,
} from "./comment-thread";

afterEach(cleanup);

const mocks = vi.hoisted(() => ({
  createComment: vi.fn(),
  isPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/mutations/comment/use-create-comment", () => ({
  default: () => ({
    mutateAsync: mocks.createComment,
    isPending: mocks.isPending,
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "me", name: "Mina", image: null } }),
}));

// The rich editor is a textarea here, with the real editor's shortcuts:
// Enter types a new line, Ctrl/Cmd+Enter sends and Escape cancels.
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
    placeholder,
    autoFocus,
    onSubmitShortcut,
    onCancelShortcut,
  }: {
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
    onSubmitShortcut?: () => void;
    onCancelShortcut?: () => void;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
      // biome-ignore lint/a11y/noAutofocus: mirrors the editor's autoFocus.
      autoFocus={autoFocus}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancelShortcut?.();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          onSubmitShortcut?.();
        }
      }}
    />
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "count" in values ? `${key}:${values.count}` : key,
  }),
}));

const replies = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    content: `Reply ${index + 1}`,
  }));

type ThreadProps = Partial<
  Omit<Parameters<typeof CommentThread>[0], "composer">
>;

/** The thread inside a stand-in card with the footer's Reply button. */
function Card(props: ThreadProps) {
  const composer = useReplyComposer();
  return (
    <article data-testid="parent-card">
      <button
        type="button"
        ref={composer.replyButtonRef}
        onClick={composer.open}
      >
        footer-reply
      </button>
      <CommentThread
        taskId="task-1"
        parentId="c1"
        replyLabel="Reply to Mia"
        replies={[]}
        canReply
        renderReply={(reply: { id: string; content?: string }) => (
          <p>{reply.content}</p>
        )}
        composer={composer}
        {...props}
      />
    </article>
  );
}

function renderThread(props: ThreadProps = {}) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <Card {...props} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const box = () =>
  screen.getByLabelText(
    "activity:comment.thread.placeholder",
  ) as HTMLTextAreaElement;

describe("CommentThread", () => {
  beforeEach(() => {
    mocks.createComment.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.isPending = false;
  });

  it("renders replies inside the parent card in a labelled list, oldest first", () => {
    renderThread({ replies: replies(2) });
    const list = screen.getByRole("list", {
      name: "activity:comment.thread.replies",
    });
    expect(screen.getByTestId("parent-card")).toContainElement(list);
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(list.textContent).toBe("Reply 1Reply 2");
  });

  it("shows only the newest replies of a long thread until expanded", () => {
    renderThread({ replies: replies(5) });
    expect(COLLAPSED_REPLY_COUNT).toBe(3);
    expect(screen.queryByText("Reply 1")).toBeNull();
    expect(screen.queryByText("Reply 2")).toBeNull();
    expect(screen.getByText("Reply 5")).toBeTruthy();
    // A notification pointing at a hidden reply still finds its thread.
    expect(document.getElementById("comment-r1")).not.toBeNull();

    const more = screen.getByRole("button", {
      name: "activity:comment.thread.showMore:2",
    });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);

    expect(screen.getByText("Reply 1")).toBeTruthy();
    const fewer = screen.getByRole("button", {
      name: "activity:comment.thread.showFewer",
    });
    expect(fewer.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fewer);
    expect(screen.queryByText("Reply 1")).toBeNull();
  });

  it("does not collapse a thread of three", () => {
    renderThread({ replies: replies(3) });
    expect(screen.getByText("Reply 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /showMore/ })).toBeNull();
  });

  it("renders nothing until Reply is chosen on a comment without replies", () => {
    renderThread();
    expect(screen.queryByTestId("comment-thread-c1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "footer-reply" }));
    const composer = screen.getByRole("region", { name: "Reply to Mia" });
    expect(screen.getByTestId("parent-card")).toContainElement(composer);
    expect(document.activeElement).toBe(box());
  });

  it("keeps a one-click reply row under existing replies", () => {
    renderThread({ replies: replies(1) });
    const prompt = screen.getByRole("button", {
      name: "activity:comment.thread.placeholder",
    });
    expect(screen.getByTestId("parent-card")).toContainElement(prompt);
    fireEvent.click(prompt);
    expect(screen.getByRole("region", { name: "Reply to Mia" })).toBeTruthy();
    expect(document.activeElement).toBe(box());
  });

  it("opens the reply row when it takes focus", () => {
    renderThread({ replies: replies(1) });
    fireEvent.focus(
      screen.getByRole("button", {
        name: "activity:comment.thread.placeholder",
      }),
    );
    expect(document.activeElement).toBe(box());
  });

  it("sends with the round arrow button, with no Cancel or text buttons", async () => {
    mocks.createComment.mockResolvedValue({ id: "r9" });
    const { invalidate } = renderThread();
    fireEvent.click(screen.getByRole("button", { name: "footer-reply" }));

    const send = screen.getByRole("button", {
      name: "activity:comment.thread.send",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.textContent).toBe("");
    expect(
      screen.queryByRole("button", { name: "common:actions.cancel" }),
    ).toBeNull();

    fireEvent.change(box(), { target: { value: "Sounds good" } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith({
        taskId: "task-1",
        comment: "Sounds good",
        parentId: "c1",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["activities", "task-1"],
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "activity:comment.thread.added",
    );
  });

  it("sends with Ctrl+Enter, while plain Enter does not send", async () => {
    mocks.createComment.mockResolvedValue({ id: "r9" });
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "footer-reply" }));
    fireEvent.change(box(), { target: { value: "Quick one" } });

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(mocks.createComment).not.toHaveBeenCalled();

    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith({
        taskId: "task-1",
        comment: "Quick one",
        parentId: "c1",
      }),
    );
  });

  it("keeps the draft when the reply fails", async () => {
    mocks.createComment.mockRejectedValue(new Error("nope"));
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "footer-reply" }));
    fireEvent.change(box(), { target: { value: "Draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: "activity:comment.thread.send" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "activity:comment.thread.failedToAdd",
      ),
    );
    expect(box().value).toBe("Draft");
  });

  it("cancels with Escape and returns focus to the card's Reply button", async () => {
    renderThread({ replies: replies(1) });
    fireEvent.click(
      screen.getByRole("button", {
        name: "activity:comment.thread.placeholder",
      }),
    );
    fireEvent.keyDown(box(), { key: "Escape" });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "footer-reply" }),
      ),
    );
    expect(screen.queryByRole("region")).toBeNull();
    // Back to the collapsed row.
    expect(
      screen.getByRole("button", {
        name: "activity:comment.thread.placeholder",
      }),
    ).toBeTruthy();
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("folds an empty composer away when focus leaves it", () => {
    renderThread({ replies: replies(1) });
    fireEvent.click(
      screen.getByRole("button", {
        name: "activity:comment.thread.placeholder",
      }),
    );
    fireEvent.blur(box(), { relatedTarget: document.body });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps a composer with a draft open when focus leaves it", () => {
    renderThread({ replies: replies(1) });
    fireEvent.click(
      screen.getByRole("button", {
        name: "activity:comment.thread.placeholder",
      }),
    );
    fireEvent.change(box(), { target: { value: "Half a thought" } });
    fireEvent.blur(box(), { relatedTarget: document.body });
    expect(screen.getByRole("region", { name: "Reply to Mia" })).toBeTruthy();
  });

  it("offers no reply row to people who can't comment", () => {
    renderThread({ replies: replies(1), canReply: false });
    expect(screen.getByText("Reply 1")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "activity:comment.thread.placeholder",
      }),
    ).toBeNull();
  });

  it("renders nothing without replies for people who can't comment", () => {
    renderThread({ canReply: false });
    expect(screen.queryByTestId("comment-thread-c1")).toBeNull();
  });
});
