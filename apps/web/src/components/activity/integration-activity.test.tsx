import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";
import { integrationActorOf } from "./integration-activity";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => `status(${status})`,
  getPriorityLabel: (priority: string) => priority,
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [{ user: { id: "user-1", name: "Ada", image: null } }],
  }),
}));

afterEach(() => cleanup());

function renderStatusChange(
  eventData: Record<string, unknown>,
  userId: string | null = null,
) {
  render(
    <Timeline>
      <Activity
        step={1}
        activity={{
          id: "activity-1",
          type: "status_changed",
          content: null,
          eventData: {
            oldStatus: "to-do",
            newStatus: "in-progress",
            ...eventData,
          },
          createdAt: "2026-03-01T10:00:00.000Z",
          userId,
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe("integration activity entries", () => {
  it("signs a task created from an issue with its author", () => {
    render(
      <Timeline>
        <Activity
          step={1}
          activity={{
            id: "activity-2",
            type: "created",
            content: null,
            eventData: { integration: { source: "github", login: "octocat" } },
            createdAt: "2026-03-01T10:00:00.000Z",
            userId: null,
            taskId: "task-1",
          }}
        />
      </Timeline>,
    );
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText("activity:created")).toBeInTheDocument();
    expect(screen.queryByText("common:people.someone")).toBeNull();
  });

  it("uses Gitea's own labels for a Gitea webhook", () => {
    renderStatusChange({ integration: { source: "gitea", login: "gitster" } });
    expect(screen.getByText("gitster")).toBeInTheDocument();
    expect(
      screen.getByText("activity:integrationActor.viaGitea"),
    ).toBeInTheDocument();
    cleanup();
    renderStatusChange({ integration: { source: "gitea" } });
    expect(
      screen.getByText("activity:integrationActor.gitea"),
    ).toBeInTheDocument();
  });

  it("names the GitHub account a webhook acted for, not Someone", () => {
    renderStatusChange({ integration: { source: "github", login: "octocat" } });
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(
      screen.getByText("activity:integrationActor.viaGithub"),
    ).toBeInTheDocument();
    expect(screen.queryByText("common:people.someone")).toBeNull();
  });

  it("names the integration when the account is unknown", () => {
    renderStatusChange({ integration: { source: "github" } });
    expect(screen.getByText("activity:comment.github")).toBeInTheDocument();
    expect(screen.queryByText("common:people.someone")).toBeNull();
  });

  it("keeps a person's own change attributed to them", () => {
    renderStatusChange(
      { integration: { source: "github", login: "octocat" } },
      "user-1",
    );
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    expect(screen.queryByText("octocat")).toBeNull();
  });
});

describe("integrationActorOf", () => {
  it("reads only a known integration marker on a row without a user", () => {
    expect(
      integrationActorOf({
        userId: null,
        eventData: { integration: { source: "github", login: "a" } },
      }),
    ).toEqual({ source: "github", login: "a" });
    expect(
      integrationActorOf({
        userId: null,
        eventData: { integration: { source: "other" } },
      }),
    ).toBeNull();
    expect(
      integrationActorOf({
        userId: null,
        eventData: { integration: { source: "gitea" } },
      }),
    ).toEqual({ source: "gitea" });
    expect(integrationActorOf({ userId: null, eventData: null })).toBeNull();
  });
});
