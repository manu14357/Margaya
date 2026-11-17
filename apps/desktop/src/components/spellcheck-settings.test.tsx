import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { languageName, SpellcheckSettings } from "./spellcheck-settings";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const LANGUAGES = ["de-DE", "en-US", "ja-JP"];

function settings(overrides: Record<string, unknown> = {}) {
  return {
    language: "system",
    languages: LANGUAGES,
    systemLanguage: "en-US",
    supported: true,
    restartNeeded: false,
    ...overrides,
  };
}

describe("SpellcheckSettings", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("follows the system by default and lists the app's languages by their own names", async () => {
    invoke.mockResolvedValue(settings());
    render(<SpellcheckSettings />);
    const select = (await screen.findByLabelText(
      "settings.spellcheckLabel",
    )) as HTMLSelectElement;
    expect(select.value).toBe("system");
    const options = Array.from(select.options).map((option) => option.value);
    expect(options).toEqual(["system", ...LANGUAGES]);
    expect(
      screen.getByRole("option", { name: "Deutsch (Deutschland)" }),
    ).toBeTruthy();
    expect(screen.queryByText("settings.spellcheckRestart")).toBeNull();
  });

  it("saves a choice and says when open windows need a restart", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "set_spellcheck"
        ? settings({ language: "de-DE", restartNeeded: true })
        : settings(),
    );
    render(<SpellcheckSettings />);
    const select = await screen.findByLabelText("settings.spellcheckLabel");
    fireEvent.change(select, { target: { value: "de-DE" } });
    expect(await screen.findByText("settings.spellcheckRestart")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("set_spellcheck", {
      language: "de-DE",
    });
    expect((select as HTMLSelectElement).value).toBe("de-DE");
  });

  it("shows no row where the system's spelling settings apply", async () => {
    invoke.mockResolvedValue(settings({ supported: false }));
    render(<SpellcheckSettings />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_spellcheck"),
    );
    expect(screen.queryByLabelText("settings.spellcheckLabel")).toBeNull();
  });

  it("shows no row with an older core", async () => {
    invoke.mockImplementation(async () => {
      throw new Error("unknown command");
    });
    render(<SpellcheckSettings />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledWith("get_spellcheck");
    expect(screen.queryByLabelText("settings.spellcheckLabel")).toBeNull();
  });

  it("names languages in their own language", () => {
    expect(languageName("de-DE")).toBe("Deutsch (Deutschland)");
    expect(languageName("not a tag")).toBe("not a tag");
  });
});
