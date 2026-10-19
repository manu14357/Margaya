import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CycleAiMenu from "./cycle-ai-menu";
import { makeCycle } from "./test-fixtures";

const m = vi.hoisted(() => ({ available: true, canRetro: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/components/ai/ai-summary", () => ({
  AiSummaryPanel: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="summary card">
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));
vi.mock("@/components/ai/brief/brief-button", () => ({
  BriefCard: () => <div role="dialog" aria-label="brief card" />,
}));
vi.mock("@/components/insight/retro-button", () => ({
  default: () => <button type="button">retro button</button>,
  RetroCard: () => <div role="dialog" aria-label="retro card" />,
  useCanRetro: () => m.canRetro,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  m.available = true;
  m.canRetro = true;
});

async function openMenu() {
  render(<CycleAiMenu cycle={makeCycle()} workspaceId="ws-1" />);
  fireEvent.click(screen.getByRole("button", { name: "ai:writing.menuLabel" }));
  await screen.findByRole("menuitem", { name: /ai:writing.summary.cycle/ });
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

describe("CycleAiMenu", () => {
  it("groups Summarize, Retro and Brief behind one AI button", async () => {
    expect(await openMenu()).toEqual([
      "ai:writing.summary.cycle",
      "insight:retro.buttonLabel",
      "ai:brief.buttonLabel",
    ]);
  });

  it("leaves Retro out when the cycle has none", async () => {
    m.canRetro = false;
    expect(await openMenu()).toEqual([
      "ai:writing.summary.cycle",
      "ai:brief.buttonLabel",
    ]);
  });

  it("opens the chosen card, which stays after the menu closes", async () => {
    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /ai:brief.buttonLabel/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "brief card" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("closes the summary card", async () => {
    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /ai:writing.summary.cycle/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog", { name: "summary card" })).toBeNull();
  });

  it("shows Retro alone, without a menu, while AI is off", () => {
    m.available = false;
    render(<CycleAiMenu cycle={makeCycle()} workspaceId="ws-1" />);
    expect(
      screen.getByRole("button", { name: "retro button" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ai:writing.menuLabel" }),
    ).toBeNull();
  });

  it("renders nothing without AI or a retro", () => {
    m.available = false;
    m.canRetro = false;
    const { container } = render(
      <CycleAiMenu cycle={makeCycle()} workspaceId="ws-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
