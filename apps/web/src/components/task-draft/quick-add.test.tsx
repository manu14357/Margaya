import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuickAdd from "./quick-add";

const bar = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("./capture-bar", () => ({
  default: (props: unknown) => {
    bar(props);
    return <input aria-label="capture bar" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const prefill = { status: "to-do", targetName: "High", priority: "high" };

describe("QuickAdd", () => {
  it("shows a light trigger and mounts the bar only when opened", () => {
    render(<QuickAdd projectId="p1" workspaceId="w1" prefill={prefill} />);
    expect(bar).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'tasks:capture.ariaLabel {"column":"High"}',
      }),
    );
    expect(screen.getByLabelText("capture bar")).toBeTruthy();
    expect(bar.mock.calls.at(-1)?.[0]).toMatchObject({
      projectId: "p1",
      workspaceId: "w1",
      prefill,
      autoFocus: true,
    });
  });

  it("opens on keyboard focus too", () => {
    render(<QuickAdd projectId="p1" workspaceId="w1" prefill={prefill} />);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByLabelText("capture bar")).toBeTruthy();
  });
});
