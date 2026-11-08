import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushNotificationCard } from "./push-notification-card";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    status: null as unknown,
    isError: false,
    support: "supported",
    permission: "default",
    turnOn: vi.fn(),
    turnOff: vi.fn(),
    remove: vi.fn(),
    register: vi.fn(async () => undefined),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { device?: string }) =>
      values?.device ? `${key}:${values.device}` : key,
  }),
}));

vi.mock("@/hooks/queries/notification-preferences/use-get-push-status", () => ({
  default: () => ({
    data: mocks.status,
    isError: mocks.isError,
    isLoading: false,
  }),
}));

vi.mock(
  "@/hooks/mutations/notification-preferences/use-push-subscription",
  () => ({
    useTurnOnPush: () => ({ mutate: mocks.turnOn, isPending: false }),
    useTurnOffPush: () => ({ mutate: mocks.turnOff, isPending: false }),
    useRemovePushDevice: () => ({ mutate: mocks.remove, isPending: false }),
  }),
);

vi.mock("@/lib/push", () => ({
  getPushSupport: () => mocks.support,
  getPushPermission: () => mocks.permission,
  registerPushWorker: mocks.register,
}));

const prefix = "settings:notificationsPage";
const thisDevice = {
  id: "d1",
  endpoint: "https://push.example.com/1",
  userAgent: "Mozilla/5.0 Chrome/120.0 Safari/537 (Linux; Android 14)",
  createdAt: "2026-11-06T00:00:00.000Z",
};
const otherDevice = {
  id: "d2",
  endpoint: "https://push.example.com/2",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1",
  createdAt: "2026-11-05T00:00:00.000Z",
};

function status(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    publicKey: "public-key",
    subscriptions: [],
    thisDevice: null,
    otherDevices: [],
    ...overrides,
  };
}

function theSwitch() {
  return screen.getByRole("switch", { name: `${prefix}.pushThisDevice` });
}

afterEach(cleanup);

beforeEach(() => {
  mocks.status = status();
  mocks.isError = false;
  mocks.support = "supported";
  mocks.permission = "default";
  for (const fn of [
    mocks.turnOn,
    mocks.turnOff,
    mocks.remove,
    mocks.register,
  ]) {
    fn.mockClear();
  }
});

describe("PushNotificationCard", () => {
  it("turns push on with the server's key", () => {
    render(<PushNotificationCard />);
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(`${prefix}.pushOffHint`)).toBeTruthy();

    fireEvent.click(theSwitch());
    expect(mocks.turnOn).toHaveBeenCalledWith("public-key");
  });

  it("only says the browser will ask when it really will", () => {
    mocks.permission = "granted";
    render(<PushNotificationCard />);
    expect(screen.queryByText(`${prefix}.pushOffHint`)).toBeNull();
    expect(screen.getByText(`${prefix}.pushOffHintAllowed`)).toBeTruthy();

    fireEvent.click(theSwitch());
    expect(mocks.turnOn).toHaveBeenCalledWith("public-key");
  });

  it("says notifications are blocked even while this device is on, and still turns it off", () => {
    mocks.status = status({ thisDevice });
    mocks.permission = "denied";
    render(<PushNotificationCard />);
    expect(screen.getByText(`${prefix}.pushBlocked`)).toBeTruthy();
    expect(screen.queryByText(`${prefix}.pushOnHint`)).toBeNull();

    fireEvent.click(theSwitch());
    expect(mocks.turnOff).toHaveBeenCalledOnce();
  });

  it("shows the current state and turns push off", () => {
    mocks.status = status({ thisDevice });
    render(<PushNotificationCard />);
    expect(theSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(`${prefix}.pushOnHint`)).toBeTruthy();
    expect(screen.getByText(`${prefix}.statusConnected`)).toBeTruthy();

    fireEvent.click(theSwitch());
    expect(mocks.turnOff).toHaveBeenCalledOnce();
    expect(mocks.turnOn).not.toHaveBeenCalled();
  });

  it("registers the worker ahead of the tap, only when push can work", () => {
    render(<PushNotificationCard />);
    expect(mocks.register).toHaveBeenCalledOnce();
    cleanup();

    mocks.register.mockClear();
    mocks.status = status({ available: false, publicKey: null });
    render(<PushNotificationCard />);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the server has no keys",
      { available: false, publicKey: null },
      "supported",
      "default",
      "pushNotSetUp",
    ],
    [
      "iOS needs installing first",
      {},
      "install-required",
      "default",
      "pushInstallFirst",
    ],
    [
      "the browser has no push",
      {},
      "unsupported",
      "default",
      "pushUnsupported",
    ],
    ["permission is blocked", {}, "supported", "denied", "pushBlocked"],
  ])(
    "explains and disables the switch when %s",
    (_name, overrides, support, permission, key) => {
      mocks.status = status(overrides);
      mocks.support = support;
      mocks.permission = permission;
      render(<PushNotificationCard />);

      expect(screen.getByText(`${prefix}.${key}`)).toBeTruthy();
      expect(
        (theSwitch() as HTMLButtonElement).getAttribute("aria-disabled") ??
          String((theSwitch() as HTMLButtonElement).disabled),
      ).toBe("true");
      fireEvent.click(theSwitch());
      expect(mocks.turnOn).not.toHaveBeenCalled();
    },
  );

  it("says so when the status can't load, rather than that push isn't set up", () => {
    mocks.status = undefined;
    mocks.isError = true;
    render(<PushNotificationCard />);
    expect(screen.getByText(`${prefix}.pushLoadFailed`)).toBeTruthy();
    expect(screen.queryByText(`${prefix}.pushNotSetUp`)).toBeNull();
  });

  it("lists other devices by browser and system, and removes them", () => {
    mocks.status = status({
      thisDevice,
      subscriptions: [thisDevice, otherDevice],
      otherDevices: [otherDevice],
    });
    render(<PushNotificationCard />);

    expect(screen.getByText(`${prefix}.pushOtherDevices`)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${prefix}.pushRemoveDeviceLabel:settings:securityPage.sessions.deviceLabel`,
      }),
    );
    expect(mocks.remove).toHaveBeenCalledWith("d2");
  });

  it("shows no device list with no other devices", () => {
    render(<PushNotificationCard />);
    expect(screen.queryByText(`${prefix}.pushOtherDevices`)).toBeNull();
  });
});
