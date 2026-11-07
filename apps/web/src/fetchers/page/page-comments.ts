import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function read<T>(response: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<T>;
}) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** Every comment on a page, oldest first. */
export async function listPageComments(pageId: string) {
  return read(
    await client.page[":id"].comments.$get({ param: { id: pageId } }),
  );
}

export async function createPageComment(pageId: string, content: string) {
  return read(
    await client.page[":id"].comments.$post({
      param: { id: pageId },
      json: { content },
    }),
  );
}

export async function updatePageComment(
  pageId: string,
  commentId: string,
  content: string,
) {
  return read(
    await client.page[":id"].comments[":commentId"].$put({
      param: { id: pageId, commentId },
      json: { content },
    }),
  );
}

export async function deletePageComment(pageId: string, commentId: string) {
  return read(
    await client.page[":id"].comments[":commentId"].$delete({
      param: { id: pageId, commentId },
    }),
  );
}

/** Whether the current user watches the page. */
export async function getPageSubscription(pageId: string) {
  return read(
    await client.page[":id"].subscription.$get({ param: { id: pageId } }),
  );
}

export async function setPageSubscription(pageId: string, watch: boolean) {
  const param = { id: pageId };
  return read(
    watch
      ? await client.page[":id"].subscription.$put({ param })
      : await client.page[":id"].subscription.$delete({ param }),
  );
}
