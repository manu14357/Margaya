import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showWhatsNew, WhatsNew } from "./whats-new";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const notes = {
  version: "1.5.0",
  url: "https://github.com/manu14357/Margaya/releases/tag/v1.5.0",
  blocks: [
    { kind: "heading", text: "Features" },
    { kind: "item", text: "<b>Shortcuts</b> you can change", depth: 0 },
    { kind: "paragraph", text: "Thanks for testing." },
  ],
};

function answer(pending: boolean, releaseNotes: unknown = notes) {
  invoke.mockImplementation(async (command: string) => {
    if (command === "whats_new_state") return { version: "1.5.0", pending };
    if (command === "release_notes") {
      if (releaseNotes instanceof Error) throw releaseNotes;
      return releaseNotes;
    }
    if (command === "dismiss_whats_new") return null;
    if (command === "open_external") return null;
    throw new Error(`unexpected command ${command}`);
  });
}

describe("WhatsNew", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("shows the notes after an update, as text, and remembers the close", async () => {
    answer(true);
    render(<WhatsNew />);
    expect(await screen.findByText("whatsNew.title")).toBeTruthy();
    expect(await screen.findByText("Features")).toBeTruthy();
    // Markup from the release stays text.
    expect(screen.getByText("<b>Shortcuts</b> you can change")).toBeTruthy();
    expect(document.querySelector(".whats-new b")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "whatsNew.openRelease" }),
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_external", { url: notes.url }),
    );
    fireEvent.click(screen.getByRole("button", { name: "whatsNew.close" }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("dismiss_whats_new"),
    );
    expect(screen.queryByText("whatsNew.title")).toBeNull();
  });

  it("stays away without an update, and opens from Settings", async () => {
    answer(false);
    render(<WhatsNew />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("whats_new_state"),
    );
    expect(screen.queryByText("whatsNew.title")).toBeNull();
    act(() => showWhatsNew());
    expect(await screen.findByText("Thanks for testing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "whatsNew.close" }));
    expect(invoke).not.toHaveBeenCalledWith("dismiss_whats_new");
  });

  it("falls back to the release link when the notes can't be read", async () => {
    answer(true, { ...notes, blocks: [] });
    render(<WhatsNew />);
    expect(await screen.findByText("whatsNew.unavailable")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "whatsNew.openRelease" }),
    ).toBeTruthy();
  });
});
