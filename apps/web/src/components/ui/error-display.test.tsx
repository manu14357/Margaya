import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { ErrorDisplay } from "./error-display";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe("ErrorDisplay", () => {
  it("shows a missing resource as not found, not as a connection problem", () => {
    render(
      <ErrorDisplay error={new HttpError(404, "Failed to fetch tasks")} />,
    );

    expect(screen.getByText("common:states.notFound.title")).toBeTruthy();
    expect(screen.getByText("common:states.notFound.description")).toBeTruthy();
    expect(screen.queryByText("common:error.messages.cors")).toBeNull();
    expect(
      screen.queryByText("common:states.error.troubleshooting"),
    ).toBeNull();
  });

  it("keeps the connection advice for a request that never got an answer", () => {
    render(<ErrorDisplay error={new TypeError("Failed to fetch")} />);

    expect(screen.getByText("common:states.error.title")).toBeTruthy();
    expect(screen.getByText("common:error.messages.cors")).toBeTruthy();
  });
});
