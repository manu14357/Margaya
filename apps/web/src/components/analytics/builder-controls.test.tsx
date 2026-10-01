import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBuilderState } from "@/lib/analytics/builder-state";
import BuilderControls from "./builder-controls";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function renderControls(
  overrides: Partial<ComponentProps<typeof BuilderControls>> = {},
) {
  render(
    <BuilderControls
      state={defaultBuilderState()}
      onChange={vi.fn()}
      dimensions={["group", "priority", "createdAt"]}
      segments={["group"]}
      pointsAvailable={false}
      {...overrides}
    />,
  );
}

describe("BuilderControls", () => {
  it("shows the Week / Month toggle only for a date x-axis", () => {
    renderControls();
    expect(
      screen.queryByRole("group", { name: "analytics:bucket.label" }),
    ).toBeNull();
    cleanup();

    renderControls({ state: defaultBuilderState("createdAt") });
    expect(
      screen.getByRole("group", { name: "analytics:bucket.label" }),
    ).toBeInTheDocument();
  });

  it("offers the metric only while points are available", () => {
    renderControls();
    expect(screen.queryByText("analytics:metric.label")).toBeNull();
    cleanup();

    renderControls({ pointsAvailable: true });
    expect(screen.getByText("analytics:metric.label")).toBeInTheDocument();
  });

  it("names the current x-axis and segment", () => {
    renderControls({
      state: { ...defaultBuilderState("priority"), segment: "group" },
    });
    expect(
      screen.getByText("analytics:dimensions.priority"),
    ).toBeInTheDocument();
    expect(screen.getByText("analytics:dimensions.group")).toBeInTheDocument();
  });
});
