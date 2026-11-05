import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getInstanceUser,
  listInstanceAdmins,
  listInstanceAuditLog,
  listInstanceDeliveryFailures,
  listInstancePublicBoards,
  listInstanceUsers,
  listInstanceWorkspaces,
} from "@/fetchers/instance-admin/instance-lists";
import {
  getInstanceOverview,
  getInstanceSettings,
} from "@/fetchers/instance-admin/instance-settings";
import type { InstanceUserStatus } from "@/types/instance-admin";

// Instance admin pages refetch on focus instead of listening on a socket:
// instance changes publish no realtime messages.

export const instanceAdminKeys = {
  all: ["instance-admin"] as const,
  overview: () => ["instance-admin", "overview"] as const,
  settings: () => ["instance-admin", "settings"] as const,
  workspaces: (q: string) => ["instance-admin", "workspaces", q] as const,
  publicBoards: (q: string) => ["instance-admin", "public-boards", q] as const,
  admins: () => ["instance-admin", "admins"] as const,
  auditLog: () => ["instance-admin", "audit-log"] as const,
  deliveryFailures: () => ["instance-admin", "delivery-failures"] as const,
  users: () => ["instance-admin", "users"] as const,
  userList: (q: string, status: InstanceUserStatus) =>
    ["instance-admin", "users", "list", q, status] as const,
  user: (userId: string) => ["instance-admin", "users", "one", userId] as const,
};

const PAGE_SIZE = 25;

export function useInstanceOverview() {
  return useQuery({
    queryKey: instanceAdminKeys.overview(),
    queryFn: getInstanceOverview,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceDeliveryFailures() {
  return useQuery({
    queryKey: instanceAdminKeys.deliveryFailures(),
    queryFn: listInstanceDeliveryFailures,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceSettings() {
  return useQuery({
    queryKey: instanceAdminKeys.settings(),
    queryFn: getInstanceSettings,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceWorkspaces(q: string) {
  const search = q.trim();
  return useInfiniteQuery({
    queryKey: instanceAdminKeys.workspaces(search),
    queryFn: ({ pageParam }) =>
      listInstanceWorkspaces({ search, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

/** Workspaces scheduled for deletion (read-only until they are purged). */
export function useInstancePendingDeletions() {
  return useQuery({
    queryKey: [...instanceAdminKeys.workspaces(""), "pending-deletion"],
    queryFn: () =>
      listInstanceWorkspaces({ pendingDeletion: true, limit: 100 }),
    refetchOnWindowFocus: true,
  });
}

export function useInstancePublicBoards(q: string) {
  const search = q.trim();
  return useInfiniteQuery({
    queryKey: instanceAdminKeys.publicBoards(search),
    queryFn: ({ pageParam }) =>
      listInstancePublicBoards({
        search,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceAdmins() {
  return useQuery({
    queryKey: instanceAdminKeys.admins(),
    queryFn: listInstanceAdmins,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceAuditLog() {
  return useInfiniteQuery({
    queryKey: instanceAdminKeys.auditLog(),
    queryFn: ({ pageParam }) =>
      listInstanceAuditLog({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceUsers(q: string, status: InstanceUserStatus) {
  const search = q.trim();
  return useInfiniteQuery({
    queryKey: instanceAdminKeys.userList(search, status),
    queryFn: ({ pageParam }) =>
      listInstanceUsers({
        search,
        status,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceUser(userId: string | null) {
  return useQuery({
    queryKey: instanceAdminKeys.user(userId ?? ""),
    queryFn: () => getInstanceUser(userId ?? ""),
    enabled: Boolean(userId),
  });
}
