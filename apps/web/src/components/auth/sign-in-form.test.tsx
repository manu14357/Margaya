import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

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
  authClient: { signIn: {}, signUp: {} },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

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
