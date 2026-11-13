import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RatingScale } from "./rating-scale";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));

afterEach(cleanup);

describe("RatingScale", () => {
  it("is a named radio group whose choices have spoken names", () => {
    render(
      <RatingScale
        format="faces3"
        value={null}
        onChange={() => {}}
        label="Q"
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Q" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: "settings:feedback.scale.happy:3" }),
    ).toBeInTheDocument();
  });

  it("reports the chosen score", () => {
    const onChange = vi.fn();
    render(
      <RatingScale format="stars" value={null} onChange={onChange} label="Q" />,
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:feedback.scale.stars:4" }),
    );
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("marks the current choice as checked", () => {
    render(
      <RatingScale format="nps" value={7} onChange={() => {}} label="Q" />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(11);
    expect(
      screen.getByRole("radio", { name: "settings:feedback.scale.npsScore:7" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
