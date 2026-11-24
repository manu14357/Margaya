import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reportChunkLoadFailure,
  resetChunkLoadFailure,
} from "@/lib/chunk-load";
import { ChunkLoadPrompt } from "./chunk-load-prompt";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  resetChunkLoadFailure();
});

describe("ChunkLoadPrompt", () => {
  it("stays hidden while everything loaded", () => {
    render(<ChunkLoadPrompt />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for a reload once a chunk failed for good", () => {
    render(<ChunkLoadPrompt />);
    act(() => reportChunkLoadFailure());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "states.loadFailed.title",
    );
    expect(
      screen.getByRole("button", { name: "states.error.reload" }),
    ).toBeInTheDocument();
  });
});
