import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsSearchEntry } from "@/lib/docs/search";
import { DocsSearch } from "./docs-search";
import { DocsToc } from "./docs-toc";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("DocsToc", () => {
  const headings = [
    { id: "one", text: "One", depth: 2 },
    { id: "two", text: "Two", depth: 2 },
    { id: "three", text: "Three", depth: 3 },
  ];
  const tops: Record<string, number> = { one: -400, two: 40, three: 600 };

  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback();
      return 0;
    });
    // A long page, scrolled somewhere in the middle.
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 5000,
    });
    for (const heading of headings) {
      const element = document.createElement("h2");
      element.id = heading.id;
      element.getBoundingClientRect = () =>
        ({ top: tops[heading.id] ?? 0 }) as DOMRect;
      document.body.append(element);
    }
  });

  it("marks the section that has passed under the header as current", async () => {
    render(<DocsToc headings={headings} />);
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Two" })?.getAttribute("aria-current"),
      ).toBe("location"),
    );
    expect(
      screen.getByRole("link", { name: "One" })?.hasAttribute("aria-current"),
    ).toBe(false);

    tops.three = 10;
    tops.two = -300;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(
      screen.getByRole("link", { name: "Three" })?.getAttribute("aria-current"),
    ).toBe("location");
  });
});

describe("DocsSearch", () => {
  const index: DocsSearchEntry[] = [
    {
      href: "/docs/core/installation/docker-compose",
      title: "Docker Compose",
      description: "Run Margaya with Docker Compose",
      section: "Guides › Installation",
      method: null,
      path: null,
      sections: [{ id: "start-the-stack", text: "Start the Docker stack" }],
      keywords: "",
    },
    {
      href: "/docs/core/cycles",
      title: "Cycles",
      description: "Time-boxed planning",
      section: "Guides › Planning",
      method: null,
      path: null,
      sections: [],
      keywords: "",
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(index)),
    );
    // jsdom has no modal dialogs; opening one only needs the `open` flag.
    HTMLDialogElement.prototype.showModal ??= function showModal(
      this: HTMLDialogElement,
    ) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(
      this: HTMLDialogElement,
    ) {
      this.open = false;
    };
    Element.prototype.scrollIntoView ??= () => {};
  });

  it("shows page and heading hits and moves through them with the arrows", async () => {
    render(<DocsSearch />);
    fireEvent.click(
      screen.getAllByRole("button", { name: /search/i })[0] as HTMLElement,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "docker" } });

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.getAttribute("href"))).toEqual([
      "/docs/core/installation/docker-compose",
      "/docs/core/installation/docker-compose#start-the-stack",
    ]);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.querySelector("mark")?.textContent).toBe("Docker");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
  });

  it("offers recent searches and quick links before typing", async () => {
    localStorage.setItem(
      "margaya-docs-recent-searches",
      JSON.stringify([{ title: "Cycles", href: "/docs/core/cycles" }]),
    );
    render(<DocsSearch />);
    fireEvent.click(
      screen.getAllByRole("button", { name: /search/i })[0] as HTMLElement,
    );
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Cycles",
      "Install",
      "API introduction",
      "Keyboard shortcuts",
    ]);
  });
});
