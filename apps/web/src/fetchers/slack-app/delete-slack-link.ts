import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteSlackLink(id: string) {
  const response = await client["slack-app"].links[":id"].$delete({
    param: { id },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default deleteSlackLink;
