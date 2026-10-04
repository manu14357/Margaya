import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignInMethod } from "@/lib/instance-settings";
import { SignInMethodCard } from "./sign-in-method-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

function method(overrides: Partial<SignInMethod> = {}): SignInMethod {
  return {
    id: "github",
    settingKey: "oauth.github.enabled",
    enabled: true,
    status: "active",
    locked: false,
    envVar: null,
    isLastActive: false,
    isProvider: true,
    ...overrides,
  };
}

function renderCard(
  value: SignInMethod,
  handlers: {
    onToggle?: (enabled: boolean) => void;
    onConfigure?: () => void;
  } = {},
) {
  const onToggle = handlers.onToggle ?? vi.fn();
  render(
    <SignInMethodCard
      method={value}
      name="GitHub"
      hint="hint"
      icon={null}
      onToggle={onToggle}
      onConfigure={handlers.onConfigure}
    />,
  );
  return { onToggle, toggle: screen.getByRole("switch") };
}

describe("SignInMethodCard", () => {
  afterEach(cleanup);

  it.each([
    ["active", "instanceAdmin:auth.status.active"],
    ["off", "instanceAdmin:auth.status.off"],
    ["notConfigured", "instanceAdmin:auth.status.notConfigured"],
    ["needsEmail", "instanceAdmin:auth.status.needsEmail"],
  ] as const)("shows the %s status", (status, label) => {
    renderCard(method({ status }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("disables the switch of the last active method", () => {
    const { toggle } = renderCard(
      method({ id: "emailPassword", isProvider: false, isLastActive: true }),
    );
    expect(toggle).toHaveAttribute("aria-disabled", "true");
  });

  it("asks before turning off a provider", async () => {
    const { onToggle, toggle } = renderCard(method());
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    expect(
      await screen.findByText("instanceAdmin:auth.disableTitle"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:auth.disableConfirm" }),
    );
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("turns a provider on without asking", () => {
    const { onToggle, toggle } = renderCard(
      method({ enabled: false, status: "off" }),
    );
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("turns email codes off without asking", () => {
    const { onToggle, toggle } = renderCard(
      method({ id: "emailCode", isProvider: false }),
    );
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("is read-only when the environment sets it", () => {
    const { toggle } = renderCard(
      method({
        id: "emailCode",
        isProvider: false,
        locked: true,
        envVar: "DISABLE_EMAIL_OTP_SIGN_IN",
      }),
    );
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("instanceAdmin:source.environment"),
    ).toBeInTheDocument();
  });

  it("offers Configure for providers", () => {
    const onConfigure = vi.fn();
    renderCard(method(), { onConfigure });
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:auth.configure" }),
    );
    expect(onConfigure).toHaveBeenCalled();
  });
});
