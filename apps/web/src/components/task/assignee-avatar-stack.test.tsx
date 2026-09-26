import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssigneeAvatarStack from "./assignee-avatar-stack";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}(${Object.values(options).join("|")})` : key,
  }),
}));

// The tooltip's content renders inline, so its names can be asserted.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
}));

afterEach(() => cleanup());

const people = [
  { id: "ana", name: "Ana Silva", image: null },
  { id: "ben", name: "Ben Ito", image: null },
  { id: "cy", name: "Cy Moss", image: null },
  { id: "dee", name: "Dee Park", image: null },
];

describe("AssigneeAvatarStack", () => {
  it("shows max faces, then the overflow chip", () => {
    render(<AssigneeAvatarStack assignees={people} max={2} />);

    const stack = screen.getByRole("img");
    expect(stack).toHaveTextContent("AS");
    expect(stack).toHaveTextContent("BI");
    expect(stack).not.toHaveTextContent("CM");
    expect(stack).toHaveTextContent("tasks:assignees.more(2)");
  });

  it("has no chip when every face fits", () => {
    render(<AssigneeAvatarStack assignees={people.slice(0, 2)} max={2} />);

    expect(screen.getByRole("img")).not.toHaveTextContent(
      "tasks:assignees.more",
    );
  });

  it("lists every name in order, in the label and the tooltip", () => {
    render(
      <AssigneeAvatarStack
        assignees={[
          people[1],
          { ...people[0], isFormerMember: true },
          { id: "ghost", name: "", image: null, isUnknown: true },
        ]}
      />,
    );

    expect(screen.getByRole("img")).toHaveAccessibleName(
      "tasks:assignees.stackAria(Ben Ito, tasks:assignees.formerMemberSuffix(Ana Silva), tasks:assignees.unknownPerson)",
    );
    const lines = Array.from(
      screen.getByTestId("tooltip").querySelectorAll("span > span"),
    ).map((line) => line.textContent);
    expect(lines).toEqual([
      "Ben Ito",
      "tasks:assignees.formerMemberSuffix(Ana Silva)",
      "tasks:assignees.unknownPerson",
    ]);
  });

  it("shows the muted question mark for nobody when asked", () => {
    render(<AssigneeAvatarStack assignees={[]} showEmpty />);

    const empty = screen.getByTitle("tasks:assignee.unassigned");
    expect(empty).toHaveTextContent("?");
    expect(empty).toHaveAccessibleName("tasks:assignee.unassigned");
  });

  it("renders nothing for nobody by default", () => {
    const { container } = render(<AssigneeAvatarStack assignees={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("stays out of the accessibility tree and skips the tooltip when decorative", () => {
    render(<AssigneeAvatarStack assignees={people} decorative />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });
});
