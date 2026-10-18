import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalImportDialog } from "./external-import-dialog";

const m = vi.hoisted(() => ({
  preview: vi.fn(),
  importItems: vi.fn(),
}));

// Interpolation values are appended so assertions can see them.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/hooks/mutations/external-import/use-external-import", () => ({
  usePreviewExternalImport: () => ({
    mutateAsync: m.preview,
    isPending: false,
  }),
  useImportExternalItems: () => ({
    mutateAsync: m.importItems,
    isPending: false,
  }),
}));

const project = {
  id: "p-1",
  columns: [
    { slug: "to-do", name: "To Do", group: "unstarted" },
    { slug: "done", name: "Done", group: "completed" },
  ],
};

const PREVIEW = {
  source: "trello",
  itemCount: 2,
  columns: [{ name: "Doing", count: 2 }],
  statuses: [
    { name: "Doing", category: null, count: 2, suggestedStatus: "to-do" },
  ],
  priorities: [],
  people: [
    { name: "Ada", count: 1, member: { id: "u1", name: "Ada" } },
    { name: "Grace", count: 1, member: null },
  ],
  totals: {
    comments: 1,
    checklists: 1,
    subtasks: 0,
    links: 0,
    alreadyImported: 0,
  },
  permissions: { update: false, comments: false },
  warnings: [],
};

function upload(name: string, type: string, content = "{}") {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("no file input");
  fireEvent.change(input, {
    target: { files: [new File([content], name, { type })] },
  });
}

describe("ExternalImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("previews a Trello board, maps lists and imports", async () => {
    m.preview.mockResolvedValue(PREVIEW);
    m.importItems.mockResolvedValue({
      total: 2,
      created: 2,
      updated: 0,
      skipped: 0,
      failed: 0,
      comments: 0,
      relations: 0,
      unmatchedPeople: ["Grace"],
      errors: [],
      warnings: [],
    });
    render(
      <ExternalImportDialog
        source="trello"
        onOpenChange={vi.fn()}
        project={project}
      />,
    );
    expect(
      screen.getByText("settings:tasksImportExport.external.title.trello"),
    ).toBeInTheDocument();

    upload("board.json", "application/json");
    expect(
      await screen.findByText(
        'settings:tasksImportExport.external.itemCount {"count":2}',
      ),
    ).toBeInTheDocument();
    expect(m.preview).toHaveBeenCalledWith({
      source: "trello",
      projectId: "p-1",
      content: "{}",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:tasksImportExport.csv.next",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Doing" })).toHaveTextContent(
      "To Do",
    );
    expect(
      screen.getByText(
        'settings:tasksImportExport.external.peopleUnmatched {"count":1,"names":"Grace"}',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'settings:tasksImportExport.external.importAction {"count":2}',
      }),
    );
    await waitFor(() => expect(m.importItems).toHaveBeenCalled());
    // Options the user can't use are sent off.
    expect(m.importItems.mock.calls[0]?.[0]).toMatchObject({
      source: "trello",
      projectId: "p-1",
      options: { mode: "skip", importComments: false },
    });
    expect(
      await screen.findByText(
        'settings:tasksImportExport.jira.result.created {"count":2}',
      ),
    ).toBeInTheDocument();
    // The summary speaks of items, not Jira's issues.
    expect(
      screen.getByText(
        'settings:tasksImportExport.external.result.unmatched {"count":1}',
      ),
    ).toBeInTheDocument();
  });

  it("refuses a file of the wrong type before uploading it", async () => {
    render(
      <ExternalImportDialog
        source="linear"
        onOpenChange={vi.fn()}
        project={project}
      />,
    );
    upload("board.json", "application/json");
    expect(
      await screen.findByText(
        "settings:tasksImportExport.external.wrongType.linear",
      ),
    ).toBeInTheDocument();
    expect(m.preview).not.toHaveBeenCalled();
  });

  it("renders nothing without a source", () => {
    const { container } = render(
      <ExternalImportDialog
        source={null}
        onOpenChange={vi.fn()}
        project={project}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
