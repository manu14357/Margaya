import { client } from "@margaya/libs";
import { responseError } from "./response-error";

/** A published board, read-only, without signing in. */
async function getPublicWhiteboard(token: string, signal?: AbortSignal) {
  const response = await client["public-whiteboard"][":token"].$get(
    { param: { token } },
    { init: { signal } },
  );
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export default getPublicWhiteboard;
