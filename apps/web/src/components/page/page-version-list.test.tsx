import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageVersionList from "./page-version-list";

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));

vi.mock("@/hooks/queries/page/use-get-page-versions", () => ({
  useGetPageVersions: () => ({
    isLoading: false,
    data: [
      {
        id: "v2",
        ownerId: "u1",
        contributorIds: ["u1", "u2", "u3"],
        lastSavedAt: "2026-10-02T10:00:00.000Z",
      },
      {
        id: "v1",
        ownerId: "u2",
        contributorIds: ["u2"],
        lastSavedAt: "2026-10-01T10:00:00.000Z",
      },
    ],
  }),
}));

afterEach(cleanup);

function renderList(selectedVersionId?: string) {
  const onSelect = vi.fn();
  render(
    <PageVersionList
      pageId="page_1"
      selectedVersionId={selectedVersionId}
      onSelect={onSelect}
      getMember={(id) =>
        id ? { id, name: `Member ${id}`, image: null } : null
      }
    />,
  );
  return { onSelect };
}

describe("PageVersionList", () => {
  it("puts the current version first, on a labelled timeline", () => {
    renderList();
    const list = screen.getByRole("list", { name: "pages:history.title" });
    expect(list.tagName).toBe("OL");
    const entries = screen.getAllByRole("button");
    expect(entries[0]).toHaveTextContent("pages:history.current");
    expect(entries[0]).toHaveAttribute("aria-current", "true");
    expect(entries).toHaveLength(3);
  });

  it("marks the selected version and selects on click", () => {
    const { onSelect } = renderList("v1");
    const entries = screen.getAllByRole("button");
    expect(entries[0]).not.toHaveAttribute("aria-current");
    expect(entries[2]).toHaveAttribute("aria-current", "true");
    fireEvent.click(entries[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("v2");
  });

  it("still names the other contributors", () => {
    renderList();
    expect(screen.getByText("pages:history.others:2")).toBeInTheDocument();
    expect(screen.getByText("Member u1")).toBeInTheDocument();
  });
});
