import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiMarkdown from "./ai-markdown";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

afterEach(() => cleanup());

describe("AiMarkdown checklists", () => {
  it("renders [ ] and [x] items as checkboxes, not raw brackets", () => {
    const { container } = render(
      <AiMarkdown
        text={
          "## Steps\n\n- [ ] Write the brief\n- [x] Book the room\n- Plain point"
        }
      />,
    );

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[0]).toBeDisabled();
    expect(container.textContent).not.toContain("[ ]");
    expect(container.textContent).not.toContain("[x]");
    expect(screen.getByText("Write the brief")).toBeInTheDocument();
    expect(screen.getByText("Plain point")).toBeInTheDocument();
  });

  it("keeps brackets that are not a leading checkbox", () => {
    const { container } = render(
      <AiMarkdown text={"- Use [x] as a marker\n\n[ ] not in a list"} />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(container.textContent).toContain("Use [x] as a marker");
    expect(container.textContent).toContain("[ ] not in a list");
  });

  it("handles loose lists, where items wrap their text in paragraphs", () => {
    render(<AiMarkdown text={"- [ ] First\n\n- [X] Second"} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([
      false,
      true,
    ]);
  });
});
