import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";
import { TwoFactorChallenge } from "./two-factor-challenge";

const auth = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: {}, navigate: vi.fn() }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: auth.signInEmail },
    signUp: {},
    twoFactor: { verifyTotp: auth.verifyTotp },
  },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("password fields", () => {
  it("names the sign-in password input by its label", () => {
    render(<SignInForm onSuccess={vi.fn()} />);
    const input = screen.getByLabelText("auth:forms.password");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("autocomplete", "current-password");
  });

  it("names the sign-up password input by its label", () => {
    render(<SignUpForm />);
    const input = screen.getByLabelText("auth:forms.password");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("autocomplete", "new-password");
  });
});

describe("forgotten password link", () => {
  it("is offered only when the server can send reset emails", () => {
    const { rerender } = render(<SignInForm onSuccess={vi.fn()} />);
    expect(screen.queryByText("auth:signInForm.forgotPassword")).toBeNull();

    rerender(<SignInForm onSuccess={vi.fn()} showForgotPassword />);
    expect(
      screen.getByRole("link", { name: "auth:signInForm.forgotPassword" }),
    ).toHaveAttribute("href", "/auth/forgot-password");
  });
});

// Better Auth's own words for a ban are English; every sign-in step shows the
// translated message the sign-in page uses for the same code.
describe("a banned account", () => {
  const banned = {
    data: null,
    error: {
      code: "BANNED_USER",
      message: "You have been banned from this application",
    },
  };

  it("is told so in its language at the password step", async () => {
    auth.signInEmail.mockResolvedValue(banned);
    render(<SignInForm onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "banned@example.com" },
    });
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signInForm.signIn" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "auth:signIn.errors.banned_user",
      ),
    );
  });

  it("is told so at the two-factor step, where a wrong code stays a wrong code", async () => {
    auth.verifyTotp.mockResolvedValueOnce(banned).mockResolvedValueOnce({
      data: null,
      error: { code: "INVALID_CODE", message: "Invalid code" },
    });
    render(<TwoFactorChallenge onSuccess={vi.fn()} onBack={vi.fn()} />);
    const code = screen.getByLabelText(
      "accountSecurity:platform.twoFactor.code",
    );
    const verify = screen.getByRole("button", {
      name: "accountSecurity:platform.twoFactor.verify",
    });
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(verify);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "auth:signIn.errors.banned_user",
    );

    fireEvent.click(verify);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "accountSecurity:platform.challenge.invalid",
      ),
    );
  });
});
