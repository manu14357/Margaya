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

  it("offers a sum of each number field and names fields by their own name", () => {
    renderControls({
      state: {
        ...defaultBuilderState("customField:tier"),
        segment: "group",
        metric: "customField:budget",
      },
      dimensions: ["group", "customField:tier"],
      fields: [
        { id: "tier", name: "Tier", type: "dropdown" },
        { id: "budget", name: "Budget", type: "number" },
      ],
    });
    // The metric shows for a number field even without points.
    expect(screen.getByText("analytics:metric.label")).toBeInTheDocument();
    expect(screen.getByText("analytics:metric.sumOf")).toBeInTheDocument();
    expect(screen.getByText("Tier")).toBeInTheDocument();
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
