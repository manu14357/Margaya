import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function duplicateView(viewId: string, name?: string) {
  const response = await client.view[":id"].duplicate.$post({
    param: { id: viewId },
    json: name ? { name } : {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default duplicateView;
