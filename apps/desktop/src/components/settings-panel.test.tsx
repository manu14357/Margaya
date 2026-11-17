import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./settings-panel";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

function answer(settings: Record<string, unknown>) {
  invoke.mockImplementation(async (command: string) => {
    if (command === "get_settings")
      return { version: "1.4.0", autostart: false, ...settings };
    if (command === "check_for_update") return "1.5.0";
    if (command === "install_update") return null;
    if (command === "set_autostart") return null;
    if (command === "copy_diagnostics") return null;
    if (command === "set_start_minimized") return null;
    if (command === "set_update_channel") return null;
    throw new Error(`unexpected command ${command}`);
  });
}

describe("SettingsPanel updates", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("restarts into the update where the app updates itself", async () => {
    answer({ platform: "windows", selfUpdate: true });
    render(<SettingsPanel />);
    await screen.findByText("settings.version");
    fireEvent.click(
      screen.getByRole("button", { name: "settings.checkUpdates" }),
    );
    expect(await screen.findByText("settings.updateAvailable")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.updateInstall" }),
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("install_update"),
    );
    expect(
      screen.getByRole("button", { name: "settings.updating" }),
    ).toBeTruthy();
  });

  it("sends a Linux package install to the download page", async () => {
    answer({ platform: "linux", selfUpdate: false });
    render(<SettingsPanel />);
    await screen.findByText("settings.version");
    fireEvent.click(
      screen.getByRole("button", { name: "settings.checkUpdates" }),
    );
    expect(await screen.findByText("settings.updatePackage")).toBeTruthy();
    expect(screen.queryByText("settings.updateInstall")).toBeNull();
    const download = screen.getByRole("button", {
      name: "settings.updateDownload",
    });
    fireEvent.click(download);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("install_update"),
    );
    // Nothing restarts: the button stays ready for another try.
    expect((download as HTMLButtonElement).disabled).toBe(false);
  });

  it("turns open at login on from its switch", async () => {
    answer({ platform: "windows", selfUpdate: true });
    render(<SettingsPanel />);
    const toggle = await screen.findByRole("switch", {
      name: "settings.openAtLogin",
    });
    await vi.waitFor(() =>
      expect((toggle as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.click(toggle);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true }),
    );
    await vi.waitFor(() =>
      expect((toggle as HTMLInputElement).checked).toBe(true),
    );
  });

  it("says when diagnostics were copied", async () => {
    answer({ platform: "windows", selfUpdate: true });
    render(<SettingsPanel />);
    fireEvent.click(
      await screen.findByRole("button", { name: "settings.copyDiagnostics" }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "settings.copied",
    );
  });

  it("starts minimized only when opening at login", async () => {
    answer({
      platform: "windows",
      selfUpdate: true,
      startMinimized: true,
      updateChannel: "stable",
    });
    render(<SettingsPanel />);
    const toggle = (await screen.findByRole("switch", {
      name: "settings.startMinimized",
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("switch", { name: "settings.openAtLogin" }),
    );
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_start_minimized", {
        enabled: false,
      }),
    );
    await vi.waitFor(() => expect(toggle.checked).toBe(false));
  });

  it("switches the update channel", async () => {
    answer({
      platform: "linux",
      selfUpdate: true,
      startMinimized: true,
      updateChannel: "stable",
    });
    render(<SettingsPanel />);
    const select = (await screen.findByRole("combobox", {
      name: "settings.updateChannel",
    })) as HTMLSelectElement;
    expect(select.value).toBe("stable");
    fireEvent.change(select, { target: { value: "beta" } });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_update_channel", {
        channel: "beta",
      }),
    );
    await vi.waitFor(() => expect(select.value).toBe("beta"));
  });

  it("hides the newer rows with an older core", async () => {
    answer({ platform: "windows", selfUpdate: true });
    render(<SettingsPanel />);
    await screen.findByText("settings.version");
    expect(screen.queryByText("settings.startMinimized")).toBeNull();
    expect(screen.queryByText("settings.updateChannel")).toBeNull();
  });
});
