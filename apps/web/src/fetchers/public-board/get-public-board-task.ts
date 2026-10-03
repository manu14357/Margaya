import { client } from "@margaya/libs";
import { loadDescriptionPages } from "@/fetchers/task/get-description-pages";
import { HttpError } from "@/lib/http-error";

/** One task of the board, with my vote and reactions. */
export async function getPublicBoardTask(
  token: string,
  number: number,
  signal?: AbortSignal,
) {
  const response = await client["public-board"][":token"].tasks[":number"].$get(
    { param: { token, number: String(number) } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** A long task description, read page by page. */
export async function getPublicBoardTaskDescription(
  token: string,
  number: number,
  signal?: AbortSignal,
) {
  return loadDescriptionPages(async (offset, version) => {
    const response = await client["public-board"][":token"].tasks[
      ":number"
    ].description.$get(
      {
        param: { token, number: String(number) },
        query: { offset: String(offset), version },
      },
      { init: { signal } },
    );
    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }
    return response.json();
  }, signal);
}
