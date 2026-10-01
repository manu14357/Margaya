import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CircleDot } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CollapsibleSection } from "./collapsible-section";

afterEach(() => {
  cleanup();
});

function Section() {
  const [open, setOpen] = useState(true);
  return (
    <CollapsibleSection
      title="Active"
      icon={CircleDot}
      count={2}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <p>Section body</p>
    </CollapsibleSection>
  );
}

describe("CollapsibleSection", () => {
  it("toggles its body and points the header at it", () => {
    render(<Section />);
    const header = screen.getByRole("button", { name: /Active/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveTextContent("2");
    const panel = document.getElementById(
      header.getAttribute("aria-controls") ?? "",
    );
    expect(panel).toHaveTextContent("Section body");

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Section body")).toBeNull();
  });
});
