import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** The board: project, settings, columns, labels and what I may do. */
async function getPublicBoard(token: string, signal?: AbortSignal) {
  const response = await client["public-board"][":token"].$get(
    { param: { token } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default getPublicBoard;
