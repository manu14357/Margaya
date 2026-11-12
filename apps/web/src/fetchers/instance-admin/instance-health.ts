import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// The health page and the update notice (instance admins only).

export async function getInstanceHealth() {
  const response = await client["instance-admin"].health.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getInstanceUpdateStatus() {
  const response = await client["instance-admin"]["update-status"].$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
