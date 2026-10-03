import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function unlockPage(pageId: string) {
  const response = await client.page[":id"].lock.$delete({
    param: { id: pageId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default unlockPage;
