import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// Instance-wide lists for admins: workspaces, published boards and admins.

type PageQuery = { search?: string; cursor?: string; limit?: number };

function pageQuery({ search, cursor, limit }: PageQuery) {
  return {
    ...(search?.trim() ? { search: search.trim() } : {}),
    ...(cursor ? { cursor } : {}),
    limit: String(limit ?? 25),
  };
}

export async function listInstanceWorkspaces(
  query: PageQuery & { pendingDeletion?: boolean },
) {
  const response = await client["instance-admin"].workspaces.$get({
    query: {
      ...pageQuery(query),
      ...(query.pendingDeletion ? { pendingDeletion: "true" as const } : {}),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function listInstancePublicBoards(query: PageQuery) {
  const response = await client["instance-admin"]["public-boards"].$get({
    query: pageQuery(query),
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function listInstanceAdmins() {
  const response = await client["instance-admin"].admins.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function addInstanceAdmin(email: string) {
  const response = await client["instance-admin"].admins.$post({
    json: { email },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function removeInstanceAdmin(userId: string) {
  const response = await client["instance-admin"].admins[":userId"].$delete({
    param: { userId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** The instance audit trail, newest first. */
export async function listInstanceAuditLog(query: {
  cursor?: string;
  limit?: number;
}) {
  const response = await client["instance-admin"]["audit-log"].$get({
    query: {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: String(query.limit ?? 25),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** Accounts on the instance (guests excluded), newest first. */
export async function listInstanceUsers(
  query: PageQuery & { status?: "all" | "admins" | "banned" },
) {
  const response = await client["instance-admin"].users.$get({
    query: { ...pageQuery(query), status: query.status ?? "all" },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getInstanceUser(userId: string) {
  const response = await client["instance-admin"].users[":userId"].$get({
    param: { userId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function banInstanceUser(
  userId: string,
  json: { reason?: string; expiresInDays?: number | null },
) {
  const response = await client["instance-admin"].users[":userId"].ban.$post({
    param: { userId },
    json,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function unbanInstanceUser(userId: string) {
  const response = await client["instance-admin"].users[":userId"].unban.$post({
    param: { userId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function revokeInstanceUserSessions(userId: string) {
  const response = await client["instance-admin"].users[":userId"][
    "revoke-sessions"
  ].$post({ param: { userId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function resetInstanceUserPassword(
  userId: string,
  json: { password?: string },
) {
  const response = await client["instance-admin"].users[":userId"][
    "reset-password"
  ].$post({ param: { userId }, json });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
