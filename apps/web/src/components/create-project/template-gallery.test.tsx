import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectTemplateSummary } from "@/fetchers/project-template/project-templates";
import type { CreateSource } from "./create-flow-model";
import { TemplateGallery } from "./template-gallery";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "count" in values ? `${key}:${values.count}` : key,
  }),
}));
vi.mock("@/components/project-templates/template-art", () => ({
  TemplateArt: () => null,
  preloadTemplateArt: vi.fn(),
}));

const counts = {
  statuses: 4,
  labels: 0,
  customFields: 0,
  views: 0,
  automationRules: 0,
  taskTemplates: 0,
  pages: 0,
  whiteboards: 0,
  modules: 0,
  sampleTasks: 0,
};

function template(
  id: string,
  categories: string[],
  name: string,
  pitch = `${name} pitch`,
): ProjectTemplateSummary {
  return {
    id,
    version: 1,
    categories,
    featured: false,
    icon: "Layout",
    name,
    pitch,
    description: "",
    suggestedKey: "KEY",
    suggestedVisibility: "open",
    counts,
    hasSampleData: false,
  };
}

const templates = [
  template("kanban", ["software-development"], "Kanban board"),
  template("bug-tracking", ["software-development"], "Bug tracking"),
  template(
    "recruitment",
    ["human-resources"],
    "Hiring",
    "Candidates and offers",
  ),
];
const categories = [
  {
    id: "software-development",
    icon: "Code",
    name: "Software",
    description: "",
  },
  { id: "human-resources", icon: "Users", name: "People", description: "" },
  { id: "legal", icon: "Scale", name: "Legal", description: "" },
];

function Harness({
  onActivate = vi.fn(),
  onSelectSpy = vi.fn(),
  initialCategory = "all",
}: {
  onActivate?: (source: CreateSource) => void;
  onSelectSpy?: (source: CreateSource) => void;
  initialCategory?: string;
}) {
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CreateSource>({ kind: "blank" });
  return (
    <TemplateGallery
      templates={templates}
      categories={categories}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      projects={[{ id: "p1", name: "Website", slug: "WEB", icon: null }]}
      categoryId={categoryId}
      onCategory={setCategoryId}
      query={query}
      onQuery={setQuery}
      source={source}
      onSelect={(next) => {
        onSelectSpy(next);
        setSource(next);
      }}
      onActivate={onActivate}
      onStartBlank={vi.fn()}
      onImport={vi.fn()}
    />
  );
}

afterEach(cleanup);

const tileNames = () =>
  within(screen.getByRole("radiogroup"))
    .getAllByRole("radio")
    .map((radio) => radio.textContent);

describe("TemplateGallery", () => {
  it("lists Blank first, then Start from an existing project, then templates", () => {
    render(<Harness />);
    const names = tileNames();
    expect(names[0]).toContain("common:modals.createProject.choose.blankName");
    expect(names[1]).toContain(
      "common:modals.createProject.choose.existingName",
    );
    expect(names.slice(2).join(" ")).toContain("Kanban board");
    expect(screen.getAllByRole("radio")[0]).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("filters by category and hides categories without templates", () => {
    render(<Harness />);
    expect(screen.queryByRole("tab", { name: "Legal" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "People" }));
    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const names = tileNames().join(" ");
    expect(names).toContain("Hiring");
    expect(names).not.toContain("Kanban board");
  });

  it("searches across categories and shows an empty state", () => {
    render(<Harness initialCategory="human-resources" />);
    const search = screen.getByRole("searchbox", {
      name: "common:modals.createProject.choose.search",
    });
    fireEvent.change(search, { target: { value: "bug" } });
    expect(tileNames()).toEqual([expect.stringContaining("Bug tracking")]);
    fireEvent.change(search, { target: { value: "payroll" } });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(
      screen.getByText("common:modals.createProject.choose.noResultsTitle"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.choose.clearSearch",
      }),
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("selects on click and continues on double click", () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);
    const kanban = screen.getByRole("radio", { name: /Kanban board/ });
    fireEvent.click(kanban);
    expect(kanban).toHaveAttribute("aria-checked", "true");
    fireEvent.doubleClick(kanban);
    expect(onActivate).toHaveBeenCalledWith({ kind: "template", id: "kanban" });
  });

  it("moves the selection with arrows and continues with Enter", () => {
    const onActivate = vi.fn();
    const onSelectSpy = vi.fn();
    render(
      <Harness
        onActivate={onActivate}
        onSelectSpy={onSelectSpy}
        initialCategory="software-development"
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("tabindex", "0");
    expect(radios[1]).toHaveAttribute("tabindex", "-1");
    // Blank -> "existing project" only moves focus; the next arrow selects.
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onSelectSpy).not.toHaveBeenCalled();
    fireEvent.keyDown(radios[1], { key: "ArrowRight" });
    expect(onSelectSpy).toHaveBeenLastCalledWith({
      kind: "template",
      id: "kanban",
    });
    fireEvent.keyDown(screen.getAllByRole("radio")[2], { key: "End" });
    expect(onSelectSpy).toHaveBeenLastCalledWith({
      kind: "template",
      id: "bug-tracking",
    });
    fireEvent.keyDown(screen.getAllByRole("radio")[3], { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith({
      kind: "template",
      id: "bug-tracking",
    });
  });

  it("jumps to the workspace's projects from the existing-project tile", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("radio", {
        name: /common:modals.createProject.choose.existingName/,
      }),
    );
    expect(
      screen.getByRole("tab", {
        name: "common:modals.createProject.choose.fromWorkspace",
      }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Website/ }));
    expect(screen.getByRole("radio", { name: /Website/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("moves between categories with the arrow keys", () => {
    render(<Harness initialCategory="all" />);
    const all = screen.getByRole("tab", {
      name: "common:modals.createProject.choose.all",
    });
    fireEvent.keyDown(all, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "Software" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
