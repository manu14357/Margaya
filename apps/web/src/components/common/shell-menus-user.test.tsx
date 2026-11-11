import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_DOWNLOAD_URL, PUBLIC_SITE_URL } from "@/constants/urls";
import { UserMenu } from "./shell-menus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/version-display", () => ({
  APP_VERSION: "1.0.0",
  CHANGELOG_URL: "https://example.com/changelog",
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Pat", email: "pat@example.com", image: null },
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/hooks/mutations/use-sign-out", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/theme-toggle-dropdown", () => ({
  ThemeToggleDropdown: () => null,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
});

function openMenu() {
  render(<UserMenu trigger={<button type="button">me</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "me" }));
}

describe("UserMenu desktop app entry", () => {
  it("links to the download page on the public site", async () => {
    openMenu();
    const item = await screen.findByRole("menuitem", {
      name: "navigation:userMenu.getDesktopApp",
    });
    expect(DESKTOP_DOWNLOAD_URL).toBe(`${PUBLIC_SITE_URL}/download`);
    expect(item.closest("a") ?? item).toHaveAttribute(
      "href",
      DESKTOP_DOWNLOAD_URL,
    );
  });

  it("offers Switch server only when the desktop app has a server list", async () => {
    openMenu();
    await screen.findByRole("menuitem", {
      name: "navigation:userMenu.settings",
    });
    expect(
      screen.queryByRole("menuitem", {
        name: "navigation:userMenu.switchServer",
      }),
    ).toBeNull();
    cleanup();

    const showServers = vi.fn();
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { version: "0.2.0", platform: "windows", showServers },
    });
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "navigation:userMenu.switchServer",
      }),
    );
    expect(showServers).toHaveBeenCalledOnce();
  });

  it("is hidden inside the desktop app", async () => {
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { version: "0.1.0", platform: "windows" },
    });
    openMenu();
    await screen.findByRole("menuitem", {
      name: "navigation:userMenu.settings",
    });
    expect(
      screen.queryByRole("menuitem", {
        name: "navigation:userMenu.getDesktopApp",
      }),
    ).toBeNull();
  });
});
