import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const continueAsGuest = vi.fn();

vi.mock("@/hooks/mutations/public-board/use-public-board-session", () => ({
  usePublicBoardSession: () => ({
    continueAsGuest: { mutate: continueAsGuest, isPending: false },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ href: "/public-project/tok" }),
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/components/auth/turnstile", () => ({
  Turnstile: ({ onVerify }: { onVerify: (token: string) => void }) => (
    <button type="button" onClick={() => onVerify("captcha-token")}>
      Solve CAPTCHA
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));

type Prompt = ComponentType<{
  token: string;
  state: { prompt: "signIn"; guestOption: boolean };
}>;

// The site key is read when the module loads, as in the built app after the
// container filled the placeholder in.
async function loadPrompt(siteKey: string) {
  vi.resetModules();
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", siteKey);
  return (await import("./participation-prompt")).default as Prompt;
}

const guestButton = () =>
  screen.getByRole("button", {
    name: "publicProject:participation.continueAsGuest",
  });

beforeEach(() => continueAsGuest.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Continue as guest", () => {
  it("signs in straight away when the deployment has no CAPTCHA key", async () => {
    const Prompt = await loadPrompt("");
    render(
      <Prompt token="tok" state={{ prompt: "signIn", guestOption: true }} />,
    );
    fireEvent.click(guestButton());
    expect(continueAsGuest).toHaveBeenCalledWith(null, expect.anything());
    expect(screen.queryByText("Solve CAPTCHA")).toBeNull();
  });

  it("treats an unreplaced placeholder as no CAPTCHA", async () => {
    const Prompt = await loadPrompt("MARGAYA_TURNSTILE_SITE_KEY");
    render(
      <Prompt token="tok" state={{ prompt: "signIn", guestOption: true }} />,
    );
    fireEvent.click(guestButton());
    expect(continueAsGuest).toHaveBeenCalledWith(null, expect.anything());
  });

  it("asks for the CAPTCHA first when a key is set", async () => {
    const Prompt = await loadPrompt("site-key");
    render(
      <Prompt token="tok" state={{ prompt: "signIn", guestOption: true }} />,
    );
    fireEvent.click(guestButton());
    expect(continueAsGuest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Solve CAPTCHA"));
    expect(continueAsGuest).toHaveBeenCalledWith(
      "captcha-token",
      expect.anything(),
    );
  });
});
