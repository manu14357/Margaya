import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";

const requestPasswordReset = vi.fn();
const resetPassword = vi.fn();
const toastError = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.email ? `${key}:${values.email}` : key,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
    resetPassword: (...args: unknown[]) => resetPassword(...args),
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ForgotPasswordForm", () => {
  it("shows the same confirmation whatever the server knows", async () => {
    requestPasswordReset.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "someone@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:forgotPassword.submit" }),
    );

    expect(
      await screen.findByText(
        "auth:forgotPassword.sentMessage:someone@example.com",
      ),
    ).toBeInTheDocument();
    expect(requestPasswordReset).toHaveBeenCalledWith(
      { email: "someone@example.com" },
      { headers: undefined },
    );
  });

  it("waits for the CAPTCHA when one is configured", () => {
    render(<ForgotPasswordForm turnstileToken={null} />);
    expect(
      screen.getByRole("button", { name: "auth:forgotPassword.submit" }),
    ).toBeDisabled();
  });
});

describe("ResetPasswordForm", () => {
  function fill(password: string, confirm: string) {
    fireEvent.change(screen.getByLabelText("auth:resetPassword.newPassword"), {
      target: { value: password },
    });
    fireEvent.change(
      screen.getByLabelText("auth:resetPassword.confirmPassword"),
      { target: { value: confirm } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "auth:resetPassword.submit" }),
    );
  }

  it("explains a missing token without showing the form", () => {
    render(<ResetPasswordForm />);
    expect(
      screen.getByText("auth:resetPassword.invalidTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "auth:resetPassword.requestNew" }),
    ).toHaveAttribute("href", "/auth/forgot-password");
  });

  it("checks the password rules and the confirmation before sending", async () => {
    render(<ResetPasswordForm token="reset-token" />);

    fill("short", "short");
    expect(
      await screen.findByText("accountSecurity:password.tooShort"),
    ).toBeInTheDocument();

    fill("a long new passphrase", "a different passphrase");
    expect(
      await screen.findByText("auth:forms.passwordsDoNotMatch"),
    ).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("sets the password and points to sign-in", async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    render(<ResetPasswordForm token="reset-token" />);

    fill("a long new passphrase", "a long new passphrase");

    expect(
      await screen.findByText("auth:resetPassword.successTitle"),
    ).toBeInTheDocument();
    expect(resetPassword).toHaveBeenCalledWith({
      newPassword: "a long new passphrase",
      token: "reset-token",
    });
  });

  it("shows the server's password policy refusal under the field", async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { code: "PASSWORD_TOO_COMMON", message: "Too common" },
    });
    render(<ResetPasswordForm token="reset-token" />);

    fill("password2024!", "password2024!");

    expect(
      await screen.findByText("accountSecurity:password.tooCommon"),
    ).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("tells the visitor when the link has expired", async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { code: "INVALID_TOKEN", message: "Invalid token" },
    });
    render(<ResetPasswordForm token="old-token" />);

    fill("a long new passphrase", "a long new passphrase");

    await waitFor(() =>
      expect(
        screen.getByText("auth:resetPassword.invalidTitle"),
      ).toBeInTheDocument(),
    );
    expect(toastError).not.toHaveBeenCalled();
  });
});
