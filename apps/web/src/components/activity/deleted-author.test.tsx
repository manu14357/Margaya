import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [{ user: { id: "user-1", name: "Ada", image: null } }],
  }),
}));

// The card itself has its own tests; here only the author it is given.
vi.mock("./comment-card", () => ({
  default: ({ user }: { user: { name?: string | null } }) => (
    <p data-testid="author">{user.name}</p>
  ),
}));

afterEach(() => cleanup());

function renderComment(userId: string | null, eventData?: unknown) {
  render(
    <Timeline>
      <Activity
        step={1}
        activity={{
          id: "comment-1",
          type: "comment",
          content: "Still here",
          eventData,
          createdAt: "2026-03-01T10:00:00.000Z",
          userId,
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe("comments of deleted authors", () => {
  it("names a deleted person", () => {
    renderComment(null);
    expect(screen.getByTestId("author")).toHaveTextContent(
      "publicProject:comments.deletedUser",
    );
  });

  it("names a deleted agent", () => {
    renderComment(null, {
      via: { agentName: "Maya", runId: "run-1", onBehalfOfName: "Ada" },
    });
    expect(screen.getByTestId("author")).toHaveTextContent(
      "ai:agents.desk.deletedAgent",
    );
  });

  it("keeps a present author's name", () => {
    renderComment("user-1");
    expect(screen.getByTestId("author")).toHaveTextContent("Ada");
  });
});
