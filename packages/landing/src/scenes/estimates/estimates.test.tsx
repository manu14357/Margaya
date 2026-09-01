import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { LandingCopyProvider } from "../../copy";
import {
  ESTIMATED_TASKS,
  EstimatesPreview,
  estimateTotals,
} from "./estimates-preview";

describe("estimates preview", () => {
  it("adds up done and total points", () => {
    expect(estimateTotals(ESTIMATED_TASKS)).toEqual({
      completed: 13,
      total: 26,
    });
  });

  it("renders the point chips and the summary from copy", () => {
    render(
      <LandingCopyProvider copy={messages.landing}>
        <EstimatesPreview />
      </LandingCopyProvider>,
    );
    expect(screen.getByText("13 / 26 pts")).toBeTruthy();
    expect(screen.getAllByText("8 pts")).toHaveLength(2);
    expect(
      screen.getByText(messages.landing.scenes.estimates.caption),
    ).toBeTruthy();
  });
});
