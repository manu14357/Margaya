import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// A page's public link: read it, publish, unpublish (revoke).

async function ensureOk(response: Response) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
}

export async function getPagePublication(pageId: string) {
  const response = await client.page[":id"].publication.$get({
    param: { id: pageId },
  });
  await ensureOk(response);
  return response.json();
}

export async function publishPage(pageId: string) {
  const response = await client.page[":id"].publish.$post({
    param: { id: pageId },
  });
  await ensureOk(response);
  return response.json();
}

export async function unpublishPage(pageId: string) {
  const response = await client.page[":id"].unpublish.$post({
    param: { id: pageId },
  });
  await ensureOk(response);
  return response.json();
}

export type PagePublication = Awaited<ReturnType<typeof getPagePublication>>;
