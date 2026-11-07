import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceUser } from "@/types/instance-admin";
import { UsersTable } from "./users-table";

const mutateAsync = vi.fn(async (_action: unknown) => ({}));
let users: InstanceUser[] = [];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/format", () => ({
  formatDateMedium: (value: string) => value,
  formatRelativeTime: () => "",
}));
vi.mock("./instance-page", () => ({ InstanceLoadState: () => null }));
vi.mock("@/hooks/queries/instance-admin/use-instance-admin", () => ({
  instanceAdminKeys: { users: () => ["instance-users"] },
  useInstanceUsers: () => ({
    data: { pages: [{ items: users }] },
    hasNextPage: false,
  }),
}));
vi.mock(
  "@/hooks/mutations/instance-admin/use-instance-admin-mutations",
  () => ({
    useInstanceUserAction: () => ({ mutateAsync, isPending: false }),
    useAddInstanceAdmin: () => ({ mutateAsync: vi.fn() }),
    useRemoveInstanceAdmin: () => ({ mutateAsync: vi.fn() }),
  }),
);
vi.mock("./user-detail-sheet", () => ({ UserDetailSheet: () => null }));
vi.mock("./user-action-dialogs", () => ({
  BanUserDialog: () => null,
  ResetPasswordDialog: () => null,
}));

const KEY = "accountSecurity:platform.users";

function user(overrides: Partial<InstanceUser> = {}): InstanceUser {
  return {
    id: "user-1",
    name: "Dana",
    email: "dana@example.com",
    image: null,
    role: "user",
    isAdmin: false,
    banned: false,
    banReason: null,
    banExpires: null,
    twoFactorEnabled: true,
    workspaceCount: 1,
    lastActiveAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as InstanceUser;
}

function openMenu() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UsersTable q="" status="all" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: `${KEY}.actionsFor` }));
}

beforeEach(() => mutateAsync.mockClear());

afterEach(cleanup);

describe("resetting two-factor from the users table", () => {
  it("is offered only for accounts that use two-factor", async () => {
    users = [user({ twoFactorEnabled: false })];
    openMenu();
    await screen.findByRole("menuitem", { name: `${KEY}.resetPassword` });
    expect(
      screen.queryByRole("menuitem", { name: `${KEY}.resetTwoFactor` }),
    ).toBeNull();
  });

  it("asks first, then resets", async () => {
    users = [user()];
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: `${KEY}.resetTwoFactor` }),
    );
    expect(mutateAsync).not.toHaveBeenCalled();

    await screen.findByText(`${KEY}.resetTwoFactorDescription`);
    fireEvent.click(
      screen.getByRole("button", { name: `${KEY}.resetTwoFactor` }),
    );
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        type: "resetTwoFactor",
        userId: "user-1",
      }),
    );
  });
});
