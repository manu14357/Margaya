import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ViewChoice from "./view-choice";

afterEach(cleanup);

const OPTIONS = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
] as const;

function renderChoice(value: "month" | "week" = "month") {
  const onChange = vi.fn();
  render(
    <ViewChoice
      label="View"
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("ViewChoice", () => {
  it("names the group and marks only the chosen segment as pressed", () => {
    renderChoice();
    const group = screen.getByRole("group", { name: "View" });
    expect(group).toHaveAttribute("data-slot", "toggle-group");
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports a new choice", () => {
    const onChange = renderChoice();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("week");
  });

  it("keeps the choice when the chosen segment is pressed again", () => {
    const onChange = renderChoice();
    const month = screen.getByRole("button", { name: "Month" });
    fireEvent.click(month);
    expect(onChange).not.toHaveBeenCalled();
    expect(month).toHaveAttribute("aria-pressed", "true");
  });
});
