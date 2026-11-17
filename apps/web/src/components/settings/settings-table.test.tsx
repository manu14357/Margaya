import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsRowActions,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableMeta,
  SettingsTableRow,
} from "./settings-table";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));

function renderTable(onRemove = vi.fn()) {
  render(
    <SettingsTable aria-label="Workspaces">
      <SettingsTableHeader>
        <SettingsTableRow>
          <SettingsTableHead>Name</SettingsTableHead>
          <SettingsTableHead>Owner</SettingsTableHead>
          <SettingsTableHead align="end" hideBelow="md">
            Members
          </SettingsTableHead>
          <SettingsTableHead>
            <span className="sr-only">Actions</span>
          </SettingsTableHead>
        </SettingsTableRow>
      </SettingsTableHeader>
      <SettingsTableBody>
        <SettingsTableRow>
          <SettingsTableCell kind="primary">
            Research
            <SettingsTableMeta hideAbove="md">
              <span>Members 12</span>
            </SettingsTableMeta>
          </SettingsTableCell>
          <SettingsTableCell label="Owner">Ada</SettingsTableCell>
          <SettingsTableCell align="end" hideBelow="md">
            12
          </SettingsTableCell>
          <SettingsTableCell kind="actions">
            <SettingsRowActions
              name="Research"
              actions={[
                { label: "Open", onClick: vi.fn() },
                { label: "Remove", onClick: onRemove, destructive: true },
              ]}
            />
          </SettingsTableCell>
        </SettingsTableRow>
      </SettingsTableBody>
    </SettingsTable>,
  );
}

describe("SettingsTable", () => {
  afterEach(cleanup);

  it("keeps table semantics with column headers and cells", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Workspaces" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    const [, row] = within(table).getAllByRole("row");
    expect(within(row).getAllByRole("cell")).toHaveLength(4);
  });

  it("labels cells for the card layout without repeating them to screen readers", () => {
    renderTable();
    const owner = screen.getByText("Ada").closest("td");
    const label = within(owner as HTMLElement).getByText("Owner");
    expect(label).toHaveAttribute("aria-hidden", "true");
    // Primary and action cells carry no label.
    expect(
      screen
        .getByText("Research")
        .closest("td")
        ?.querySelector("[aria-hidden]"),
    ).toBeNull();
  });

  it("hides low-priority columns with a container query and repeats them as meta", () => {
    renderTable();
    expect(
      screen.getByRole("columnheader", { name: "Members" }).className,
    ).toContain("@max-[48rem]/settings-table:hidden");
    const meta = screen.getByText("Members 12").parentElement as HTMLElement;
    expect(meta).toHaveAttribute("data-slot", "settings-table-meta");
    expect(meta.className).toContain("hidden");
    expect(meta.className).toContain("@max-[48rem]/settings-table:flex");
  });

  it("right-aligns numbers with tabular figures", () => {
    renderTable();
    const cell = screen.getByText("12").closest("td") as HTMLElement;
    expect(cell.className).toContain("text-end");
    expect(cell.className).toContain("tabular-nums");
  });
});

describe("SettingsRowActions", () => {
  afterEach(cleanup);

  it("folds the actions into a menu named after the row", async () => {
    const onRemove = vi.fn();
    renderTable(onRemove);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:table.actionsFor:Research",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
