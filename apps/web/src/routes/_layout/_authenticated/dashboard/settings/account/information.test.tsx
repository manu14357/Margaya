import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./information";

const m = vi.hoisted(() => ({
  update: vi.fn(),
  refetchUser: vi.fn(),
  success: vi.fn(),
  user: { id: "u1", name: "Mia Member", email: "mia@example.com" },
  hasSmtp: true,
  requestEmailChange: vi.fn(),
  changeEmail: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: m.user, refetchUser: m.refetchUser }),
}));
vi.mock("@/hooks/mutations/use-update-user-profile", () => ({
  default: () => ({ mutateAsync: m.update }),
}));
vi.mock("@/hooks/mutations/use-update-user-avatar", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/use-remove-user-avatar", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/use-delete-account", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
  SESSION_TOO_OLD: "SESSION_TOO_OLD",
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: { hasSmtp: m.hasSmtp } }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    emailOtp: {
      requestEmailChange: m.requestEmailChange,
      changeEmail: m.changeEmail,
    },
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));

const Component = Route.options.component as ComponentType;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue({});
  m.refetchUser.mockResolvedValue(undefined);
  m.hasSmtp = true;
});

describe("personal information autosave", () => {
  it("saves a name replaced in one step", async () => {
    render(<Component />);
    fireEvent.change(
      screen.getByPlaceholderText(
        "settings:informationPage.fullNamePlaceholder",
      ),
      { target: { value: "Mia Pasted" } },
    );

    await waitFor(() => expect(m.success).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(m.update).toHaveBeenCalledWith({ name: "Mia Pasted" });
  });
});

describe("email change", () => {
  it("confirms the new address with a code sent to it", async () => {
    m.requestEmailChange.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    m.changeEmail.mockResolvedValue({ data: { success: true }, error: null });
    render(<Component />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "accountSecurity:emailChange.action",
      }),
    );
    fireEvent.change(
      await screen.findByLabelText("accountSecurity:emailChange.newEmail"),
      { target: { value: "mia@new.example.com" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "accountSecurity:emailChange.sendCode",
      }),
    );
    await waitFor(() =>
      expect(m.requestEmailChange).toHaveBeenCalledWith({
        newEmail: "mia@new.example.com",
      }),
    );

    fireEvent.change(
      await screen.findByLabelText("accountSecurity:emailChange.code"),
      { target: { value: "123456" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "accountSecurity:emailChange.confirm",
      }),
    );
    await waitFor(() =>
      expect(m.changeEmail).toHaveBeenCalledWith({
        newEmail: "mia@new.example.com",
        otp: "123456",
      }),
    );
    expect(m.refetchUser).toHaveBeenCalled();
  });

  it("explains why the address can't change without outgoing email", () => {
    m.hasSmtp = false;
    render(<Component />);
    expect(
      screen.queryByRole("button", {
        name: "accountSecurity:emailChange.action",
      }),
    ).toBeNull();
    expect(
      screen.getByText("accountSecurity:emailChange.unavailable"),
    ).toBeInTheDocument();
  });
});
