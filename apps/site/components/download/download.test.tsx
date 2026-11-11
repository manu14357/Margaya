import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DesktopFile,
  download,
  type GitHubRelease,
  toDesktopRelease,
} from "@/lib/desktop-release";
import { DesktopPlatformProvider } from "./desktop-platform";
import { DownloadFiles } from "./download-files";
import { DownloadPicker } from "./download-picker";
import { LinuxCommands } from "./linux-commands";

const AGENTS = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  linuxArm: "Mozilla/5.0 (X11; Linux aarch64; rv:133.0) Gecko/20100101",
};

const NAMES = [
  "Margaya_1.4.0_aarch64.dmg",
  "Margaya_1.4.0_x64.dmg",
  "Margaya_1.4.0_x64-setup.exe",
  "Margaya_1.4.0_x64_en-US.msi",
  "Margaya_1.4.0_amd64.AppImage",
  "Margaya_1.4.0_amd64.deb",
  "Margaya-1.4.0-1.x86_64.rpm",
  "Margaya_1.4.0_aarch64.AppImage",
  "Margaya_1.4.0_arm64.deb",
  "Margaya-1.4.0-1.aarch64.rpm",
];

const github: GitHubRelease = {
  tag_name: "v1.4.0",
  html_url: "https://example.com/releases/v1.4.0",
  draft: false,
  prerelease: false,
  published_at: "2026-11-10T12:00:00Z",
  assets: NAMES.map((name) => ({
    name,
    browser_download_url: `https://example.com/download/${name}`,
    size: 9_800_000,
    digest: `sha256:${"a".repeat(64)}`,
  })),
};
const files = toDesktopRelease(github)?.files as DesktopFile[];

function visit(userAgent: string) {
  vi.stubGlobal("navigator", {
    userAgent,
    maxTouchPoints: 0,
    clipboard: { writeText: vi.fn(async () => {}) },
  });
}

function Picker() {
  return (
    <DownloadPicker
      files={files}
      copy={{ ...download.picker, ...download.meta }}
      version="1.4.0"
      releasedOn="November 10, 2026"
      notesUrl={github.html_url}
      allDownloadsHref="#downloads"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("download picker", () => {
  it("offers one button for a Windows visitor, with version and size", async () => {
    visit(AGENTS.windows);
    render(
      <DesktopPlatformProvider>
        <Picker />
      </DesktopPlatformProvider>,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /Download for Mac/ }),
      ).toBeNull(),
    );
    const button = screen.getByRole("link", { name: /Download for Windows/ });
    expect(button.getAttribute("href")).toContain(
      "Margaya_1.4.0_x64-setup.exe",
    );
    expect(button.textContent).toContain("Version 1.4.0");
    expect(button.textContent).toContain("9.3 MB");
    expect(
      screen
        .getByRole("link", { name: download.picker.otherPlatforms })
        .getAttribute("href"),
    ).toBe("#downloads");
  });

  it("gives a Mac visitor Apple Silicon first and the Intel file as a link", async () => {
    visit(AGENTS.macos);
    render(
      <DesktopPlatformProvider>
        <Picker />
      </DesktopPlatformProvider>,
    );
    const intel = await screen.findByRole("link", {
      name: download.picker.otherMacIntel,
    });
    expect(intel.getAttribute("href")).toContain("Margaya_1.4.0_x64.dmg");
    expect(
      screen
        .getByRole("link", { name: /Download for Mac/ })
        .getAttribute("href"),
    ).toContain("Margaya_1.4.0_aarch64.dmg");
  });
});

describe("downloads and Linux install commands", () => {
  function Page({ withFiles = true }: { withFiles?: boolean }) {
    return (
      <DesktopPlatformProvider>
        {withFiles ? (
          <DownloadFiles
            files={files}
            copy={download.files}
            tabs={download.platforms}
          />
        ) : null}
        <LinuxCommands
          files={withFiles ? files : []}
          copy={download.firstLaunch.linux}
          code={download.code}
        />
      </DesktopPlatformProvider>
    );
  }

  it("opens on the visitor's platform and architecture, and follows the picked one", async () => {
    visit(AGENTS.linuxArm);
    render(<Page />);
    const linuxTab = screen.getByRole("tab", { name: /Linux/ });
    await waitFor(() =>
      expect(linuxTab.getAttribute("aria-selected")).toBe("true"),
    );

    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByRole("link", {
        name: "Download Margaya_1.4.0_aarch64.AppImage",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "sudo zypper install --allow-unsigned-rpm ./Margaya-1.4.0-1.aarch64.rpm",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: download.files.x64 }));
    expect(
      within(panel).getByRole("link", {
        name: "Download Margaya_1.4.0_amd64.deb",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("sudo apt install ./Margaya_1.4.0_amd64.deb"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `Copy commands: ${download.firstLaunch.linux.opensuse}`,
      }),
    ).toBeTruthy();
  });

  it("shows file name patterns before the first release", () => {
    visit(AGENTS.windows);
    render(<Page withFiles={false} />);
    expect(
      screen.getByText("sudo dnf install ./Margaya-*.x86_64.rpm"),
    ).toBeTruthy();
  });
});
