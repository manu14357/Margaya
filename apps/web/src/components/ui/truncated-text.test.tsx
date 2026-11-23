import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "@/lib/format";
import { CompactDate } from "./compact-date";
import { MiddleTruncate, TruncatedText } from "./truncated-text";

vi.mock("@/lib/i18n", () => ({
  i18n: { resolvedLanguage: "en-US", language: "en-US" },
}));

function mockOverflow(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(
    scrollWidth,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    clientWidth,
  );
}

describe("TruncatedText", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is not a tab stop while the text fits", () => {
    mockOverflow(80, 120);
    render(<TruncatedText text="ada@example.org" />);
    const trigger = screen.getByText("ada@example.org")
      .parentElement as HTMLElement;
    expect(trigger).not.toHaveAttribute("tabindex");
    expect(trigger).not.toHaveAttribute("data-truncated");
  });

  it("takes focus once it is cut, so the full value can be read", () => {
    mockOverflow(300, 120);
    render(<TruncatedText text="Platform infrastructure reliability" />);
    const trigger = screen.getByText("Platform infrastructure reliability")
      .parentElement as HTMLElement;
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveAttribute("data-truncated", "true");
  });

  it("keeps an email's domain visible and the whole address in the DOM", () => {
    mockOverflow(80, 120);
    const { container } = render(
      <TruncatedText text="constantina.operations@example.org" middle />,
    );
    expect(screen.getByText("@example.org")).toHaveClass("shrink-0");
    expect(container.textContent).toBe("constantina.operations@example.org");
  });
});

describe("MiddleTruncate", () => {
  afterEach(cleanup);

  it("carries the full value in its title", () => {
    render(<MiddleTruncate text="b.vanderbilt@example.org" />);
    expect(screen.getByTitle("b.vanderbilt@example.org")).toHaveTextContent(
      "b.vanderbilt@example.org",
    );
  });
});

describe("CompactDate", () => {
  afterEach(cleanup);

  it("shows a short date and gives screen readers the exact time", () => {
    const value = new Date("2024-03-02T08:30:00Z");
    const { container } = render(<CompactDate value={value} />);
    const time = container.querySelector("time") as HTMLElement;
    expect(time).toHaveAttribute("datetime", value.toISOString());
    expect(time.querySelector("[aria-hidden]")).toHaveTextContent(
      "Mar 2, 2024",
    );
    expect(time.querySelector(".sr-only")?.textContent).toMatch(/2024/);
  });

  it("never puts a just-created moment in the future", () => {
    const value = new Date(Date.now() + 3_000);
    const { container } = render(<CompactDate value={value} />);
    const label = container.querySelector("time [aria-hidden]");
    expect(label?.textContent).not.toMatch(/^in /);
    expect(label?.textContent).toBe(formatRelativeTime(new Date()));
  });

  it("renders nothing for an invalid date", () => {
    const { container } = render(<CompactDate value="not a date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
