import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectAccessSettings from "./project-access-settings";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
let visibility = "open";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/module/module-people", () => ({
  useWorkspacePeople: () => [
    { id: "guest-1", name: "Gus", image: null },
    { id: "member-1", name: "Mia", image: null },
  ],
  PersonAvatar: () => null,
  PeopleList: ({
    people,
    onSelect,
  }: {
    people: { id: string; name: string }[];
    onSelect: (id: string) => void;
  }) => (
    <ul>
      {people.map((person) => (
        <li key={person.id}>
          <button type="button" onClick={() => onSelect(person.id)}>
            {person.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock("@/hooks/mutations/project/use-project-access", () => ({
  default: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/hooks/queries/project/use-project-access", () => ({
  default: () => ({
    isError: false,
    data: { visibility, leadUserId: null, members: [], canManage: true },
  }),
}));

vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "guest-1", role: "guest" },
          { userId: "member-1", role: "member" },
        ],
      },
    }),
  }),
);

function renderAndOpenPicker() {
  render(<ProjectAccessSettings workspaceId="w1" projectId="p1" />);
  fireEvent.click(
    screen.getByRole("button", { name: "settings:projectAccess.addMember" }),
  );
}

describe("ProjectAccessSettings", () => {
  beforeEach(() => {
    visibility = "open";
    mutateAsync.mockClear();
  });
  afterEach(() => cleanup());

  it("offers only guests in an open project, read-only to start", () => {
    renderAndOpenPicker();
    expect(
      screen.getByText("settings:projectAccess.guestsHint"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mia" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gus" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      kind: "add",
      userId: "guest-1",
      role: "viewer",
    });
  });

  it("offers everyone in a restricted project, members as member", () => {
    visibility = "restricted";
    renderAndOpenPicker();
    expect(
      screen.getByText("settings:projectAccess.membersHint"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mia" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      kind: "add",
      userId: "member-1",
      role: "member",
    });
  });
});
