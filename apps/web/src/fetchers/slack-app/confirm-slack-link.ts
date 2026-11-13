import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function confirmSlackLink(token: string) {
  const response = await client["slack-app"].links.$post({ json: { token } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default confirmSlackLink;
