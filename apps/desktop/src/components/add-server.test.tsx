import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddServer } from "./add-server";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const discovery = {
  webUrl: "https://margaya.example.com",
  apiUrl: "https://api.margaya.example.com",
  serverVersion: "1.4.0",
  insecure: false,
  suggestedLabel: "margaya.example.com",
};

function typeAndConnect(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "add.urlLabel" }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "add.connect" }));
}

describe("AddServer", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("discovers a server and adds it under the chosen name", async () => {
    const onAdded = vi.fn();
    invoke.mockImplementation(async (command: string) => {
      if (command === "discover_server") return discovery;
      if (command === "add_server")
        return { ...discovery, id: "s1", label: "Work" };
      throw new Error(command);
    });
    render(<AddServer onAdded={onAdded} />);

    typeAndConnect(" margaya.example.com ");
    expect(await screen.findByText("add.found")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("discover_server", {
      input: "margaya.example.com",
    });

    const name = screen.getByRole("textbox", {
      name: "add.nameLabel",
    }) as HTMLInputElement;
    expect(name.value).toBe("margaya.example.com");
    fireEvent.change(name, { target: { value: "Work" } });
    fireEvent.click(screen.getByRole("button", { name: "add.submit" }));

    await vi.waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("add_server", {
      discovery,
      label: "Work",
    });
  });

  it("warns about plain http and asks for confirmation", async () => {
    invoke.mockResolvedValue({
      ...discovery,
      webUrl: "http://10.0.0.5",
      insecure: true,
    });
    render(<AddServer onAdded={() => {}} />);
    typeAndConnect("http://10.0.0.5");
    expect(await screen.findByText("add.httpWarning")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "add.confirmHttp" }),
    ).toBeTruthy();
  });

  it("explains an untrusted certificate and links the help page", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "discover_server")
        throw { kind: "tlsUntrusted", message: "certificate" };
      return undefined;
    });
    render(<AddServer onAdded={() => {}} />);
    typeAndConnect("https://intranet.example");
    expect(await screen.findByText(/errors\.tlsUntrusted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "errors.tlsHelp" }));
    expect(invoke).toHaveBeenCalledWith("open_external", {
      url: expect.stringContaining("certificates"),
    });
  });

  it("names the minimum version when the app is too old", async () => {
    invoke.mockRejectedValue({
      kind: "desktopTooOld",
      message: "",
      detail: "2.0.0",
    });
    render(<AddServer onAdded={() => {}} />);
    typeAndConnect("margaya.example.com");
    expect(await screen.findByText("errors.desktopTooOld")).toBeTruthy();
  });

  it("checks a server from a confirmed deep link straight away", async () => {
    invoke.mockResolvedValue(discovery);
    render(
      <AddServer initialUrl="https://margaya.example.com" onAdded={() => {}} />,
    );
    expect(await screen.findByText("add.found")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("discover_server", {
      input: "https://margaya.example.com",
    });
  });
});
