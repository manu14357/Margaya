import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Connections to an identity provider, for instance admins. A SCIM token only
// comes back from creating or rotating; the server keeps just its hash.

const scim = client["instance-admin"].identity.scim;
const saml = client["instance-admin"].identity.saml;

export type CreateScimConnectionInput = InferRequestType<
  typeof scim.$post
>["json"];
export type CreateSamlConnectionInput = InferRequestType<
  typeof saml.$post
>["json"];
export type UpdateSamlConnectionInput = InferRequestType<
  (typeof saml)[":id"]["$patch"]
>["json"];

export async function listScimConnections() {
  const response = await scim.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function createScimConnection(json: CreateScimConnectionInput) {
  const response = await scim.$post({ json });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function rotateScimConnectionToken(id: string) {
  const response = await scim[":id"].rotate.$post({ param: { id } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function deleteScimConnection(id: string) {
  const response = await scim[":id"].$delete({ param: { id } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function listSamlConnections() {
  const response = await saml.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** The addresses for a connection that doesn't exist yet; creates nothing. */
export async function draftSamlConnection() {
  const response = await saml.new.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function createSamlConnection(json: CreateSamlConnectionInput) {
  const response = await saml.$post({ json });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function updateSamlConnection(
  id: string,
  json: UpdateSamlConnectionInput,
) {
  const response = await saml[":id"].$patch({ param: { id }, json });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function deleteSamlConnection(id: string) {
  const response = await saml[":id"].$delete({ param: { id } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
