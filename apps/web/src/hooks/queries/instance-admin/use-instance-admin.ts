import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  listInstanceAdmins,
  listInstancePublicBoards,
  listInstanceWorkspaces,
} from "@/fetchers/instance-admin/instance-lists";
import {
  getInstanceOverview,
  getInstanceSettings,
} from "@/fetchers/instance-admin/instance-settings";

// Instance admin pages refetch on focus instead of listening on a socket:
// instance changes publish no realtime messages.

export const instanceAdminKeys = {
  all: ["instance-admin"] as const,
  overview: () => ["instance-admin", "overview"] as const,
  settings: () => ["instance-admin", "settings"] as const,
  workspaces: (q: string) => ["instance-admin", "workspaces", q] as const,
  publicBoards: (q: string) => ["instance-admin", "public-boards", q] as const,
  admins: () => ["instance-admin", "admins"] as const,
};

const PAGE_SIZE = 25;

export function useInstanceOverview() {
  return useQuery({
    queryKey: instanceAdminKeys.overview(),
    queryFn: getInstanceOverview,
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
