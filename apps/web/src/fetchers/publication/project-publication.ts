import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { PublicationSettingsPatch } from "@/types/publication";

// A project's public board: read it, publish, unpublish, change its
// settings and rotate its link (each answers the publication).

const route = () => client.publication.project[":projectId"];

export async function getProjectPublication(
  projectId: string,
  signal?: AbortSignal,
) {
  const response = await route().$get(
    { param: { projectId } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function publishProject(projectId: string) {
  const response = await route().publish.$post({
    param: { projectId },
    json: {},
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function unpublishProject(projectId: string) {
  const response = await route().unpublish.$post({ param: { projectId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function updateProjectPublication(
  projectId: string,
  patch: PublicationSettingsPatch,
) {
  const response = await route().$patch({ param: { projectId }, json: patch });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function rotateProjectPublicationLink(projectId: string) {
  const response = await route()["rotate-link"].$post({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
