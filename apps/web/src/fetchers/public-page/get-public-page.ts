import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** A published page, read-only, without signing in. */
async function getPublicPage(token: string, signal?: AbortSignal) {
  const response = await client["public-page"][":token"].$get(
    { param: { token } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export type PublicPage = Awaited<ReturnType<typeof getPublicPage>>;

export default getPublicPage;
