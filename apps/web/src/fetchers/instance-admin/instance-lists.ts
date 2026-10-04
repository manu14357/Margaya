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

export async function listInstanceWorkspaces(query: PageQuery) {
  const response = await client["instance-admin"].workspaces.$get({
    query: pageQuery(query),
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
