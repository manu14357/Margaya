import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  publish: vi.fn(),
  status: vi.fn(),
}));

vi.mock("../../../../../apps/api/src/database", () => ({
  default: {
    query: {
      externalLinkTable: {
        findFirst: async () => ({ id: "link-1", taskId: "t1", metadata: null }),
      },
      taskTable: {
        findFirst: async () => ({ id: "t1", projectId: "p1" }),
      },
    },
  },
}));
vi.mock("../../../../../apps/api/src/events", () => ({
  publishEvent: m.publish,
}));
vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({ updateExternalLink: vi.fn() }),
);
vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({ updateTaskStatus: m.status }),
);
vi.mock(
  "../../../../../apps/api/src/plugins/gitea/services/integration-lookup",
  () => ({
    findAllIntegrationsByGiteaRepo: async () => [{ id: "integration-1" }],
    repoOwnerLogin: () => "acme",
  }),
);
vi.mock(
  "../../../../../apps/api/src/plugins/gitea/utils/resolve-column",
  () => ({
    resolveTargetStatus: async () => "to-do",
  }),
);

const { handleGiteaIssueReopened } = await import(
  "../../../../../apps/api/src/plugins/gitea/webhooks/issue-reopened"
);

beforeEach(() => {
  vi.clearAllMocks();
  m.status.mockResolvedValue({
    applied: true,
    before: { status: "done" },
    after: {
      id: "t1",
      projectId: "p1",
      status: "to-do",
      title: "T",
      userId: null,
    },
  });
});

it("attributes a Gitea status change to the account that sent it", async () => {
  await handleGiteaIssueReopened({
    action: "reopened",
    sender: { login: "gitster" },
    issue: {
      number: 1,
      title: "Issue",
      html_url: "https://gitea.example.com/acme/repo/issues/1",
      state: "open",
    },
    repository: {
      owner: { login: "acme" },
      name: "repo",
      html_url: "https://gitea.example.com/acme/repo",
    },
  });
  expect(m.publish).toHaveBeenCalledWith(
    "task.status_changed",
    expect.objectContaining({
      userId: null,
      integration: { source: "gitea", login: "gitster" },
    }),
  );
});
