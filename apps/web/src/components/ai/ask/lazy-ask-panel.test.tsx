import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginSignOut, endSignOut } from "@/lib/sign-out";
import { useAskPanel } from "./ask-store";
import LazyAskPanel from "./lazy-ask-panel";

const mocks = vi.hoisted(() => ({ loaded: vi.fn() }));

// The real panel is the chat with Build, history and Markdown answers.
vi.mock("./ask-panel", () => {
  mocks.loaded();
  return { default: () => <div data-testid="ask-panel" /> };
});

afterEach(() => {
  cleanup();
  useAskPanel.setState({ open: false, slot: null, request: null });
  window.localStorage.clear();
});

describe("LazyAskPanel", () => {
  it("clears saved conversations on sign-out before the panel has loaded", () => {
    window.localStorage.setItem("margaya:ask-history:v1:u1:w1", "[]");
    window.localStorage.setItem("margaya:ask-current:v1:u1:w1", "c1");
    window.localStorage.setItem("margaya:other", "keep");
    render(<LazyAskPanel />);
    beginSignOut();
    endSignOut();
    expect(
      window.localStorage.getItem("margaya:ask-history:v1:u1:w1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("margaya:ask-current:v1:u1:w1"),
    ).toBeNull();
    expect(window.localStorage.getItem("margaya:other")).toBe("keep");
    expect(mocks.loaded).not.toHaveBeenCalled();
  });

  it("loads the panel when Ask first opens and keeps it mounted", async () => {
    render(<LazyAskPanel />);
    expect(screen.queryByTestId("ask-panel")).toBeNull();
    expect(mocks.loaded).not.toHaveBeenCalled();

    act(() => useAskPanel.getState().openAsk({ question: "What changed?" }));
    expect(await screen.findByTestId("ask-panel")).toBeInTheDocument();
    expect(mocks.loaded).toHaveBeenCalledTimes(1);

    act(() => useAskPanel.getState().setOpen(false));
    expect(screen.getByTestId("ask-panel")).toBeInTheDocument();
  });

  it("loads the panel for the full-page chat's slot", async () => {
    render(<LazyAskPanel />);
    act(() => useAskPanel.getState().setSlot(document.createElement("div")));
    expect(await screen.findByTestId("ask-panel")).toBeInTheDocument();
  });
});
