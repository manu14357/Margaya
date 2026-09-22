import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, toastManager } from "./toast";

afterEach(cleanup);

describe("toasts", () => {
  it("are status messages, and errors are alerts, never dialogs", async () => {
    render(<ToastProvider />);
    act(() => {
      toastManager.add({ title: "Saved", type: "success" });
      toastManager.add({ title: "Failed", type: "error" });
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
