import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

afterEach(cleanup);

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "name" in values ? `${key}:${values.name}` : key,
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [
      { user: { id: "user-1", name: "Mia", image: null } },
      { user: { id: "user-2", name: "Ada", image: null } },
    ],
  }),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-2", name: "Ada", image: null } }),
}));

vi.mock("@/components/ai/translate/translatable-content", () => ({
  default: ({
    text,
    children,
  }: {
    text: string;
    children: (text: string, translated: boolean) => ReactNode;
  }) => <>{children(text, false)}</>,
}));

vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
    placeholder,
    readOnly,
    autoFocus,
    onCancelShortcut,
  }: {
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    readOnly?: boolean;
    autoFocus?: boolean;
    onCancelShortcut?: () => void;
  }) =>
    readOnly ? (
      <p>{value}</p>
    ) : (
      <textarea
        aria-label={placeholder}
        value={value}
        // biome-ignore lint/a11y/noAutofocus: mirrors the editor's autoFocus.
        autoFocus={autoFocus}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancelShortcut?.();
        }}
      />
    ),
}));

const comment = (
  id: string,
  userId: string,
  content: string,
  parentId?: string,
) => ({
  id,
  type: "comment",
  content,
  createdAt: "2026-03-01T10:00:00.000Z",
  userId,
  taskId: "task-1",
  parentId: parentId ?? null,
});

function renderFeed(
  replyCount: number,
  {
    visibility,
    boardOpen,
  }: { visibility?: "internal" | "public"; boardOpen?: boolean } = {},
) {
  const replies = Array.from({ length: replyCount }, (_, index) =>
    comment(`r${index + 1}`, "user-2", `Reply ${index + 1}`, "c1"),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Timeline>
        <Activity
          step={1}
          rail
          activity={{
            ...comment("c1", "user-1", "Parent comment"),
            ...(visibility ? { visibility } : {}),
          }}
          replies={replies}
          canReply
          publicBoard={
            boardOpen === undefined
              ? undefined
              : { projectId: "p1", open: boardOpen, canModerate: false }
          }
        />
      </Timeline>
    </QueryClientProvider>,
  );
  return document.getElementById("comment-c1") as HTMLElement;
}

describe("a comment with its thread on the feed", () => {
  it("shows its replies inside the parent's card", () => {
    const card = renderFeed(2);
    const list = within(card).getByRole("list", {
      name: "activity:comment.thread.replies",
    });
    expect(within(list).getByText("Reply 1")).toBeInTheDocument();
    expect(within(list).getByText("Reply 2")).toBeInTheDocument();
    // Each reply keeps its own anchor for notifications.
    expect(card).toContainElement(document.getElementById("comment-r1"));
  });

  it("opens the composer inside the card from the footer's Reply, then Escape returns there", async () => {
    const card = renderFeed(0);
    const reply = within(card).getByRole("button", {
      name: "activity:comment.thread.replyTo:Mia",
    });
    fireEvent.click(reply);

    const composer = within(card).getByRole("region", {
      name: "activity:comment.thread.replyTo:Mia",
    });
    const box = within(composer).getByLabelText(
      "activity:comment.thread.placeholder",
    );
    expect(document.activeElement).toBe(box);

    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(reply));
    expect(within(card).queryByRole("region")).toBeNull();
  });

  it("collapses a long thread inside the card", () => {
    const card = renderFeed(5);
    const more = within(card).getByRole("button", {
      name: /activity:comment.thread.showMore/,
    });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByText("Reply 1")).toBeNull();
    fireEvent.click(more);
    expect(within(card).getByText("Reply 1")).toBeInTheDocument();
  });

  it("offers Public on replies only under a public comment of an open board", () => {
    const cases = [
      { visibility: "public", boardOpen: true, offered: true },
      { visibility: "internal", boardOpen: true, offered: false },
      { visibility: "public", boardOpen: false, offered: false },
      { visibility: "public", boardOpen: undefined, offered: false },
    ] as const;
    for (const { visibility, boardOpen, offered } of cases) {
      const card = renderFeed(0, { visibility, boardOpen });
      fireEvent.click(
        within(card).getByRole("button", {
          name: "activity:comment.thread.replyTo:Mia",
        }),
      );
      const composer = within(card).getByRole("region", {
        name: "activity:comment.thread.replyTo:Mia",
      });
      expect(
        within(composer).queryByRole("button", {
          name: "activity:commentVisibility.public",
        }) !== null,
        `${visibility} / ${boardOpen}`,
      ).toBe(offered);
      cleanup();
    }
  });
});
