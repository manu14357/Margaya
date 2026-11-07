import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwoFactorSection } from "./two-factor-section";

const config = vi.fn();
const enable = vi.fn();
const verifyTotp = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: config() }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      enable: (...args: unknown[]) => enable(...args),
      verifyTotp: (...args: unknown[]) => verifyTotp(...args),
    },
  },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const KEY = "accountSecurity:platform.twoFactor";

function renderSection(props: Parameters<typeof TwoFactorSection>[0]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TwoFactorSection {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  config.mockReturnValue({ requireTwoFactor: false });
  enable.mockReset();
  verifyTotp.mockReset();
});

afterEach(cleanup);

describe("TwoFactorSection", () => {
  it("offers turning it off while the server doesn't require it", () => {
    renderSection({ enabled: true });
    expect(screen.getByText(`${KEY}.turnOff`)).toBeTruthy();
    expect(screen.queryByText(`${KEY}.requiredHint`)).toBeNull();
  });

  it("explains instead of offering it when the server requires it", () => {
    config.mockReturnValue({ requireTwoFactor: true });
    renderSection({ enabled: true });
    expect(screen.queryByText(`${KEY}.turnOff`)).toBeNull();
    expect(screen.getByText(`${KEY}.requiredHint`)).toBeTruthy();
    expect(screen.getByText(`${KEY}.newCodes`)).toBeTruthy();
  });

  it("walks the setup screen through to the recovery codes, then on", async () => {
    enable.mockResolvedValue({
      data: {
        totpURI: "otpauth://totp/Margaya:a?secret=ABCDEFGH",
        backupCodes: ["code-one", "code-two"],
      },
    });
    verifyTotp.mockResolvedValue({ data: { status: true } });
    const onFinished = vi.fn();
    renderSection({ enabled: false, setupScreen: true, onFinished });

    // The password step is already open: there's nothing else to do here.
    fireEvent.change(screen.getByLabelText(`${KEY}.confirmPassword`), {
      target: { value: "a long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.continue` }));

    const code = await screen.findByLabelText(`${KEY}.code`);
    expect(enable).toHaveBeenCalledWith(
      expect.objectContaining({ password: "a long passphrase" }),
    );
    expect(screen.getByText("ABCD EFGH")).toBeTruthy();
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.verify` }));

    // They must see the recovery codes before leaving.
    await screen.findByText("code-one");
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByText(`${KEY}.on`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `${KEY}.done` }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
  });

  it("stays on the code step after a wrong code", async () => {
    enable.mockResolvedValue({
      data: { totpURI: "otpauth://totp/a?secret=AB", backupCodes: ["x"] },
    });
    verifyTotp.mockResolvedValue({ error: { message: "bad" } });
    const onFinished = vi.fn();
    renderSection({ enabled: false, setupScreen: true, onFinished });
    fireEvent.change(screen.getByLabelText(`${KEY}.confirmPassword`), {
      target: { value: "a long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.continue` }));
    const code = await screen.findByLabelText(`${KEY}.code`);
    fireEvent.change(code, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.verify` }));
    await waitFor(() => expect(verifyTotp).toHaveBeenCalled());
    expect(screen.getByLabelText(`${KEY}.code`)).toBeTruthy();
    expect(screen.queryByText(`${KEY}.done`)).toBeNull();
    expect(onFinished).not.toHaveBeenCalled();
  });
});
