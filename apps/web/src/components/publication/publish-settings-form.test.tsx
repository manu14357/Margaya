import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectPublication } from "@/types/publication";
import PublishSettingsForm from "./publish-settings-form";

const mutate = vi.fn();

vi.mock("@/hooks/mutations/publication/use-publication-mutations", () => ({
  useUpdatePublication: () => ({ mutate }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);
beforeEach(() => mutate.mockReset());

const base: ProjectPublication = {
  projectId: "p1",
  published: true,
  publishedAt: "2026-10-01T00:00:00.000Z",
  publishedBy: null,
  linkToken: "abcdefghijklmnopqrstuv",
  path: "/public-project/abcdefghijklmnopqrstuv",
  layouts: ["board", "list"],
  defaultLayout: "board",
  commentsEnabled: false,
  reactionsEnabled: false,
  votesEnabled: false,
  requestsEnabled: false,
  allowGuests: false,
  showAssignees: false,
  showBacklog: false,
  availability: {
    publicBoards: true,
    participation: true,
    requests: true,
    guests: true,
  },
  canManage: true,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function renderForm(overrides: Partial<ProjectPublication> = {}) {
  render(
    <PublishSettingsForm
      projectId="p1"
      publication={{ ...base, ...overrides }}
    />,
  );
}

const control = (name: string) =>
  screen.getByRole("switch", { name: `settings:projectPublish.${name}` });

describe("PublishSettingsForm", () => {
  it("saves a switch as soon as it changes", () => {
    renderForm();
    fireEvent.click(control("participation.comments"));
    expect(mutate).toHaveBeenCalledWith(
      { commentsEnabled: true },
      expect.any(Object),
    );
  });

  it("disables every control without project:share", () => {
    renderForm({ canManage: false });
    for (const name of [
      "participation.comments",
      "participation.votes",
      "content.assignees",
      "content.backlog",
    ]) {
      expect(control(name)).toHaveAttribute("aria-disabled", "true");
    }
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.click(control("participation.comments"));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("disables requests until the project's intake is on", () => {
    renderForm({
      availability: { ...base.availability, requests: false },
    });
    expect(control("participation.requests")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByText(
        "settings:projectPublish.participation.requestsNeedIntake",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the last layout checked", () => {
    renderForm({ layouts: ["list"], defaultLayout: "list" });
    const list = screen.getByRole("checkbox", {
      name: "settings:projectPublish.layouts.list",
    });
    expect(list).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(list);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "settings:projectPublish.layouts.board",
      }),
    );
    expect(mutate).toHaveBeenCalledWith(
      { layouts: ["board", "list"] },
      expect.any(Object),
    );
  });

  it("explains when guests or participation have no effect", () => {
    renderForm({
      availability: {
        ...base.availability,
        guests: false,
        participation: false,
      },
    });
    expect(
      screen.getByText("settings:projectPublish.participation.guestsOffServer"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings:projectPublish.participation.off"),
    ).toBeInTheDocument();
  });
});
