import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// Requests sent from a public board to the project's intake.

export async function submitPublicBoardRequest(
  token: string,
  input: { title: string; description?: string },
) {
  const response = await client["public-board"][":token"].requests.$post({
    param: { token },
    json: input,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function listMyPublicBoardRequests(
  token: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  const response = await client["public-board"][":token"].requests.mine.$get(
    { param: { token }, query: cursor ? { cursor } : {} },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function withdrawPublicBoardRequest(
  token: string,
  requestId: string,
) {
  const response = await client["public-board"][":token"].requests[
    ":requestId"
  ].$delete({ param: { token, requestId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
