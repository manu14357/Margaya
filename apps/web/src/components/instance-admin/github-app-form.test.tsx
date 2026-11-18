import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InstanceSettingEntry,
  InstanceSettings,
} from "@/types/instance-admin";
import { GithubAppForm } from "./github-app-form";

const save = vi.fn(async (_values: Record<string, unknown>) => true);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./use-save-instance-settings", () => ({
  useSaveInstanceSettings: () => ({ save, isPending: false }),
}));

const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA",
  "-----END RSA PRIVATE KEY-----",
].join("\n");
const WEBHOOK_URL = "http://api.test/api/github-integration/webhook";

function entry(
  key: string,
  overrides: Partial<InstanceSettingEntry> = {},
): InstanceSettingEntry {
  const secret =
    key === "githubApp.privateKey" || key === "githubApp.webhookSecret";
  return {
    key,
    group: "githubApp",
    ...(secret ? {} : { value: "" }),
    source: "default",
    locked: false,
    envVar: null,
    secret,
    configured: false,
    unreadable: false,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  } as InstanceSettingEntry;
}

function settingsWith(
  overrides: Record<string, Partial<InstanceSettingEntry>> = {},
  app: Partial<InstanceSettings["derived"]["githubApp"]> = {},
): InstanceSettings {
  return {
    locked: false,
    settings: [
      "githubApp.appId",
      "githubApp.appName",
      "githubApp.privateKey",
      "githubApp.webhookSecret",
    ].map((key) => entry(key, overrides[key])),
    derived: {
      githubApp: {
        configured: false,
        managedByEnvironment: false,
        webhookUrl: WEBHOOK_URL,
        envVars: [],
        ...app,
      },
    },
  } as unknown as InstanceSettings;
}

afterEach(() => {
  cleanup();
  save.mockClear();
});

describe("GitHub App settings form", () => {
  it("explains the setup and shows the webhook URL while nothing is set up", () => {
    render(<GithubAppForm settings={settingsWith()} />);
    expect(
      screen.getByText("instanceAdmin:githubApp.stepsTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /instanceAdmin:githubApp.createOnGithub/,
      }),
    ).toHaveAttribute("href", "https://github.com/settings/apps/new");
    expect(screen.getByDisplayValue(WEBHOOK_URL)).toBeInTheDocument();
  });

  it("saves the App ID, name, private key and a generated webhook secret", async () => {
    render(<GithubAppForm settings={settingsWith()} />);
    fireEvent.change(screen.getByLabelText("instanceAdmin:githubApp.appId"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("instanceAdmin:githubApp.appName"), {
      target: { value: "margaya-example" },
    });
    // A text area keeps the PEM's line breaks.
    const key = screen.getByLabelText("instanceAdmin:githubApp.privateKey");
    expect(key.tagName).toBe("TEXTAREA");
    fireEvent.change(key, { target: { value: PEM } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "instanceAdmin:githubApp.generateSecret",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:githubApp.save" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const patch = save.mock.calls[0]?.[0] ?? {};
    expect(patch).toMatchObject({
      "githubApp.appId": "123456",
      "githubApp.appName": "margaya-example",
      "githubApp.privateKey": PEM,
    });
    expect(patch["githubApp.webhookSecret"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("won't save a non-numeric App ID or text that isn't a key", () => {
    render(<GithubAppForm settings={settingsWith()} />);
    fireEvent.change(screen.getByLabelText("instanceAdmin:githubApp.appId"), {
      target: { value: "Iv23abc" },
    });
    expect(
      screen.getByText("instanceAdmin:githubApp.appIdInvalid"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("instanceAdmin:githubApp.appId"), {
      target: { value: "1" },
    });
    fireEvent.change(
      screen.getByLabelText("instanceAdmin:githubApp.privateKey"),
      { target: { value: "http://localhost:1337/api/auth/callback/github" } },
    );
    expect(
      screen.getByText("instanceAdmin:githubApp.privateKeyInvalid"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "instanceAdmin:githubApp.save" }),
    ).toBeDisabled();
  });

  it("links to the App's install page once it is set up", () => {
    render(
      <GithubAppForm
        settings={settingsWith(
          {
            "githubApp.appId": { value: "123", source: "database" },
            "githubApp.appName": {
              value: "margaya-example",
              source: "database",
            },
            "githubApp.privateKey": { configured: true, source: "database" },
            "githubApp.webhookSecret": { configured: true, source: "database" },
          },
          { configured: true },
        )}
      />,
    );
    expect(
      screen.queryByText("instanceAdmin:githubApp.stepsTitle"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /instanceAdmin:githubApp.install/ }),
    ).toHaveAttribute(
      "href",
      "https://github.com/apps/margaya-example/installations/new",
    );
    expect(
      screen.getByRole("button", { name: "instanceAdmin:githubApp.remove" }),
    ).toBeInTheDocument();
  });

  it("is read-only when environment variables manage the App", () => {
    render(
      <GithubAppForm
        settings={settingsWith(
          {
            "githubApp.appId": {
              value: "123",
              source: "environment",
              locked: true,
              envVar: "GITHUB_APP_ID",
            },
          },
          { configured: true, managedByEnvironment: true },
        )}
      />,
    );
    expect(
      screen.getByText("instanceAdmin:githubApp.managedByEnv"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("instanceAdmin:githubApp.appId"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "instanceAdmin:githubApp.save" }),
    ).not.toBeInTheDocument();
  });
});
