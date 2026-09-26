import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

type DescriptionPage = {
  content: string;
  version: string;
  nextOffset: number | null;
};

export async function loadDescriptionPages(
  load: (offset: number, version?: string) => Promise<DescriptionPage>,
  signal?: AbortSignal,
) {
  const chunks: string[] = [];
  let offset = 0;
  let version: string | undefined;
  while (true) {
    signal?.throwIfAborted();
    const page = await load(offset, version);
    if (version !== undefined && page.version !== version)
      throw new Error("Description changed while loading");
    version = page.version;
    chunks.push(page.content);
    if (page.nextOffset === null) break;
    if (page.nextOffset <= offset)
      throw new Error("Description page did not advance");
    offset = page.nextOffset;
  }
  signal?.throwIfAborted();
  return chunks.join("");
}

export async function getPublicProjectDescription(
  projectId: string,
  signal?: AbortSignal,
) {
  return loadDescriptionPages(async (offset, version) => {
    const response = await client["public-project"][":id"].description.$get(
      { param: { id: projectId }, query: { offset: String(offset), version } },
      { init: { signal } },
    );
    if (!response.ok)
      throw new HttpError(
        response.status,
        "Failed to load project description",
      );
    return response.json();
  }, signal);
}
