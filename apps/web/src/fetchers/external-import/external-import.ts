import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

type ImportBody = InferRequestType<
  (typeof client)["external-import"][":source"][":projectId"]["$post"]
>["json"];

export type ExternalImportSource = "trello" | "linear" | "asana";
export type ExternalImportOptions = NonNullable<ImportBody["options"]>;

/** The browser's time zone: Asana writes calendar days without an offset. */
function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Reads a Trello, Linear or Asana export on the server without importing it. */
export async function previewExternalImport(
  source: ExternalImportSource,
  projectId: string,
  content: string,
) {
  const response = await client["external-import"][":source"][
    ":projectId"
  ].preview.$post({
    param: { source, projectId },
    json: { content, timeZone: browserTimeZone() },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function importExternalItems({
  source,
  projectId,
  content,
  options,
}: {
  source: ExternalImportSource;
  projectId: string;
  content: string;
  options: ExternalImportOptions;
}) {
  const response = await client["external-import"][":source"][
    ":projectId"
  ].$post({
    param: { source, projectId },
    json: { content, timeZone: browserTimeZone(), options },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export type ExternalImportPreview = Awaited<
  ReturnType<typeof previewExternalImport>
>;
export type ExternalImportResult = Awaited<
  ReturnType<typeof importExternalItems>
>;
