import { atom, onMount } from "nanostores";
import { describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  atoms: {} as Record<string, unknown>,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { $store: { atoms: stores.atoms } },
}));
vi.mock("@/fetchers/oauth/get-id-token", () => ({ getIdToken: vi.fn() }));

import { authStoresFetching } from "./use-sign-out";

function authStore(isRefetching: boolean) {
  const store = atom({ data: null, isRefetching });
  const mounted = vi.fn();
  onMount(store, () => {
    // A Better Auth query store fetches when it mounts.
    mounted();
  });
  return { store, mounted };
}

describe("authStoresFetching", () => {
  // Mounting a Better Auth store starts its request, which then raced the
  // sign-out into a 401.
  it("reads the organization stores without mounting them", () => {
    const idle = {
      activeOrganization: authStore(false),
      listOrganizations: authStore(false),
      activeMember: authStore(false),
      activeMemberRole: authStore(false),
    };
    for (const [name, { store }] of Object.entries(idle)) {
      stores.atoms[name] = store;
    }

    expect(authStoresFetching()).toBe(false);
    for (const { mounted } of Object.values(idle)) {
      expect(mounted).not.toHaveBeenCalled();
    }

    stores.atoms.activeMember = authStore(true).store;
    expect(authStoresFetching()).toBe(true);
  });
});
