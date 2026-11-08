import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SamlSignIn } from "./saml-sign-in";

const m = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { $fetch: m.fetch } }));
vi.mock("@/lib/toast", () => ({ toast: { error: m.error } }));

const CALLBACK = "https://app.example/dashboard";
const SIGN_IN = "https://app.example/auth/sign-in";

function renderSignIn(props: Partial<Parameters<typeof SamlSignIn>[0]> = {}) {
  render(
    <SamlSignIn callbackURL={CALLBACK} errorCallbackURL={SIGN_IN} {...props} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "auth:signIn.continueWithSaml" }),
  );
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText("auth:signIn.samlEmail"), {
    target: { value: email },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "auth:signIn.samlSubmit" }),
  );
}

describe("SamlSignIn", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("asks for the address only when chosen, so routine sign-in stays short", () => {
    render(<SamlSignIn callbackURL={CALLBACK} errorCallbackURL={SIGN_IN} />);
    expect(screen.queryByLabelText("auth:signIn.samlEmail")).toBeNull();
  });

  it("starts sign-in for the address and leaves the redirect to the auth client", async () => {
    m.fetch.mockResolvedValue({
      data: { url: "https://idp.example/sso?SAMLRequest=abc", redirect: true },
      error: null,
    });
    const attempted = vi.fn();
    renderSignIn({ turnstileToken: "captcha", onAttemptComplete: attempted });
    submit(" Pat@Acme.example ".trim());

    await waitFor(() => expect(attempted).toHaveBeenCalled());
    expect(m.error).not.toHaveBeenCalled();
    expect(m.fetch).toHaveBeenCalledWith("/sign-in/sso", {
      method: "POST",
      body: {
        email: "pat@acme.example",
        callbackURL: CALLBACK,
        errorCallbackURL: SIGN_IN,
        providerType: "saml",
      },
      headers: { "x-turnstile-token": "captcha" },
    });
  });

  it("says when the domain has no connection, and stays put", async () => {
    m.fetch.mockResolvedValue({
      data: null,
      error: { status: 404, message: "No provider found for the issuer" },
    });
    renderSignIn();
    submit("pat@other.example");

    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith("auth:signIn.samlNoConnection"),
    );
  });

  it("shows the server's reason for any other refusal", async () => {
    m.fetch.mockResolvedValue({
      data: null,
      error: { status: 403, message: "Sign in with GitHub." },
    });
    renderSignIn();
    submit("pat@acme.example");

    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith("Sign in with GitHub."),
    );
  });

  it("says something useful when the server can't be reached", async () => {
    m.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    renderSignIn();
    submit("pat@acme.example");

    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith("auth:signIn.samlError"),
    );
  });

  it("won't submit without a usable address or while the captcha is pending", () => {
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:signIn.samlEmail"), {
      target: { value: "not-an-address" },
    });
    expect(
      screen.getByRole("button", { name: "auth:signIn.samlSubmit" }),
    ).toBeDisabled();
    cleanup();

    render(
      <SamlSignIn callbackURL={CALLBACK} errorCallbackURL={SIGN_IN} disabled />,
    );
    expect(
      screen.getByRole("button", { name: "auth:signIn.continueWithSaml" }),
    ).toBeDisabled();
  });
});
