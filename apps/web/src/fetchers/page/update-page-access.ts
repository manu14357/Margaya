import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updatePageAccess(pageId: string, access: "public" | "private") {
  const response = await client.page[":id"].access.$put({
    param: { id: pageId },
    json: { access },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updatePageAccess;
