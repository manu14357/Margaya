import { beforeEach, describe, expect, it, vi } from "vitest";
import getTasks from "./get-tasks";

const { privateRequest } = vi.hoisted(() => ({
  privateRequest: vi.fn(),
}));
vi.mock("@margaya/libs", () => ({
  client: {
    task: { tasks: { ":projectId": { $get: privateRequest } } },
  },
}));
function data(page: number) {
  return {
    id: "project",
    name: "Project",
    slug: "project",
    icon: null,
    description: null,
    isPublic: true,
    workspaceId: "workspace",
    columns: [
      {
        id: "todo",
        slug: "todo",
        name: "To do",
        icon: null,
        isFinal: false,
        tasks: [
          {
            id: `task-${page}`,
            title: `Task ${page}`,
            description: `text-${page}`,
            labels: [],
            externalLinks: [],
          },
        ],
      },
    ],
    archivedTasks: [],
    plannedTasks: [],
  };
}
beforeEach(() => {
  privateRequest.mockReset();
});
describe("authenticated board fetcher", () => {
  it("reads every page through the typed client and propagates cancellation", async () => {
    const request = privateRequest;
    request.mockImplementation(
      async ({ query }: { query: { page: string } }) => {
        const page = Number(query.page);
        const pagination = { page, pageSize: 100, total: 201, totalPages: 3 };
        return Response.json({ data: data(page), pagination });
      },
    );
    const controller = new AbortController();
    const result = await getTasks("project", controller.signal);
    expect(result.columns[0].tasks.map((task) => task.id)).toEqual([
      "task-1",
      "task-2",
      "task-3",
    ]);
    expect(request).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 3; index++)
      expect(request.mock.calls[index]).toEqual([
        {
          param: { projectId: "project" },
          query: { page: String(index + 1), limit: "100" },
        },
        { init: { signal: controller.signal } },
      ]);
  });
  it("sends relatedPage for continuations and merges their labels", async () => {
    const request = privateRequest;
    request.mockImplementation(
      async ({ query }: { query: { relatedPage?: string } }) => {
        const related = Number(query.relatedPage ?? 1);
        const board = data(1);
        Object.assign(board.columns[0].tasks[0], {
          labels: [{ id: `label-${related}`, name: "Label", color: "red" }],
        });
        const pagination = {
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
          relatedTotalPages: 2,
        };
        return Response.json({ data: board, pagination });
      },
    );
    const result = await getTasks("project");
    expect(result.columns[0].tasks[0].labels).toHaveLength(2);
    expect(request.mock.calls[1][0].query).toMatchObject({
      page: "1",
      relatedPage: "2",
      limit: "100",
    });
  });
});
