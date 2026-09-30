import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteView(viewId: string) {
  const response = await client.view[":id"].$delete({ param: { id: viewId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteView;
