import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getView(viewId: string) {
  const response = await client.view[":id"].$get({ param: { id: viewId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getView;
