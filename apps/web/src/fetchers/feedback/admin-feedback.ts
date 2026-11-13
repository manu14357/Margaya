import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { fileNameFromDisposition } from "@/lib/task-export/file-name";

// Instance settings → Feedback: the summary, the answers, CSV and deletion.

export type AdminFeedbackFilters = {
  kind?: "general" | "survey" | "feature";
  format?: "faces3" | "faces5" | "stars" | "nps" | "thumbs";
  score?: number;
  hasComment?: boolean;
  search?: string;
  days?: number;
};

export type AdminFeedbackSummary = InferResponseType<
  (typeof client)["instance-admin"]["feedback"]["summary"]["$get"],
  200
>;
export type AdminFeedbackPage = InferResponseType<
  (typeof client)["instance-admin"]["feedback"]["$get"],
  200
>;
export type AdminFeedback = AdminFeedbackPage["items"][number];

/** The query strings the filter routes take. */
export function adminFeedbackQuery(filters: AdminFeedbackFilters) {
  return {
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.format ? { format: filters.format } : {}),
    ...(filters.score !== undefined ? { score: String(filters.score) } : {}),
    ...(filters.hasComment !== undefined
      ? {
          hasComment: filters.hasComment
            ? ("true" as const)
            : ("false" as const),
        }
      : {}),
    ...(filters.search?.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.days ? { days: String(filters.days) } : {}),
  };
}

async function ok<T extends Response>(response: T): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response;
}

export async function getAdminFeedbackSummary(query: {
  format?: AdminFeedbackFilters["format"];
  kind?: AdminFeedbackFilters["kind"];
  days: number;
}) {
  const response = await ok(
    await client["instance-admin"].feedback.summary.$get({
      query: {
        ...(query.format ? { format: query.format } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        days: String(query.days),
      },
    }),
  );
  return (await response.json()) as AdminFeedbackSummary;
}

export async function listAdminFeedback(
  filters: AdminFeedbackFilters,
  cursor?: string,
) {
  const response = await ok(
    await client["instance-admin"].feedback.$get({
      query: {
        ...adminFeedbackQuery(filters),
        ...(cursor ? { cursor } : {}),
        limit: "25",
      },
    }),
  );
  return (await response.json()) as AdminFeedbackPage;
}

export async function exportAdminFeedback(filters: AdminFeedbackFilters) {
  const response = await ok(
    await client["instance-admin"].feedback.export.$get({
      query: adminFeedbackQuery(filters),
    }),
  );
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(
    response.headers.get("Content-Disposition"),
    "feedback.csv",
  );
  return { blob, fileName };
}

export async function deleteAdminFeedback(id: string) {
  const response = await ok(
    await client["instance-admin"].feedback[":id"].$delete({ param: { id } }),
  );
  return (await response.json()) as { deleted: number };
}

export async function purgeAdminFeedback(olderThanDays: number) {
  const response = await ok(
    await client["instance-admin"].feedback.$delete({
      query: { olderThanDays: String(olderThanDays) },
    }),
  );
  return (await response.json()) as { deleted: number };
}
