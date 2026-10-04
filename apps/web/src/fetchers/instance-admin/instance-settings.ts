import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { InstanceSettingsPatch } from "@/types/instance-admin";

// The instance settings catalog: effective values, sources and locks. Secret
// values never come back, only whether one is configured.

export async function getInstanceSettings() {
  const response = await client["instance-admin"].settings.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function updateInstanceSettings(values: InstanceSettingsPatch) {
  const response = await client["instance-admin"].settings.$patch({
    json: { values },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getInstanceOverview() {
  const response = await client["instance-admin"].overview.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function sendInstanceTestEmail(to?: string) {
  const response = await client["instance-admin"].email.test.$post({
    json: to ? { to } : {},
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
