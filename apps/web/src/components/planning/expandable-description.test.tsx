import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExpandableDescription from "./expandable-description";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
});

describe("ExpandableDescription", () => {
  it("renders nothing without text, and no toggle for short text", () => {
    const { container, rerender } = render(
      <ExpandableDescription text={null} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<ExpandableDescription text="Short" />);
    expect(screen.getByText("Short")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("expands and collapses long text", () => {
    render(<ExpandableDescription text={"Long words. ".repeat(20)} />);
    const toggle = screen.getByRole("button", {
      name: "planning:description.showMore",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("planning:description.showLess");
  });
});
