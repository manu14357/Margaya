import { type AiStreamError, client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { streamAiRoute } from "./ai";

// AI build (B6): the duplicate check on create and "talk to build". The
// proposal is only a suggestion; apply creates what the person reviewed
// through the ordinary create routes and streams its progress.

type BuildClient = (typeof client)["ai"]["build"];

// Error bodies are JSON (AI errors) or text; both keep their raw text for
// aiErrorKey().
async function ok<T>(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

export type DuplicateCheckRequest = InferRequestType<
  BuildClient["duplicates"]["$post"]
>["json"];
export type DuplicateCheck = InferResponseType<
  BuildClient["duplicates"]["$post"],
  200
>;

export async function checkDuplicatesWithAi(body: DuplicateCheckRequest) {
  return ok<DuplicateCheck>(
    await client.ai.build.duplicates.$post({ json: body }),
  );
}

export type BuildProposalRequest = InferRequestType<
  BuildClient["proposal"]["$post"]
>["json"];
export type BuildProposalResult = InferResponseType<
  BuildClient["proposal"]["$post"],
  200
>;
export type BuildProposal = BuildProposalResult["proposal"];

export async function proposeBuild(
  body: BuildProposalRequest,
  signal?: AbortSignal,
) {
  return ok<BuildProposalResult>(
    await client.ai.build.proposal.$post({ json: body }, { init: { signal } }),
  );
}

export type ApplyBuildRequest = InferRequestType<
  BuildClient["apply"]["$post"]
>["json"];

export type BuildProgress = {
  done: number;
  total: number;
  kind: string;
  name: string;
  ok: boolean;
};

export type BuildReport = {
  projectId: string | null;
  total: number;
  done: number;
  created: {
    project: boolean;
    columns: number;
    cycles: number;
    modules: number;
    tasks: number;
    subtasks: number;
    labels: number;
  };
  estimatesSkipped: boolean;
  failures: { kind: string; name: string; status: number; message: string }[];
  /** Pass to undoBuild within an hour; absent when nothing was created. */
  undoToken?: string;
};

/**
 * Creates a reviewed proposal; `onProgress` follows each item. Resolves
 * with the report, or rejects with the API's error (code and message).
 */
export async function applyBuild(
  body: ApplyBuildRequest,
  onProgress: (progress: BuildProgress) => void,
): Promise<BuildReport> {
  let report: BuildReport | null = null;
  let failure: AiStreamError | null = null;
  await streamAiRoute("/ai/build/apply", body, {
    onEvent: (event, data) => {
      if (event === "progress") onProgress(data as BuildProgress);
    },
    onDone: (done) => {
      report = done as unknown as BuildReport;
    },
    onError: (error) => {
      failure = error;
    },
  });
  if (report) return report;
  const error = failure as AiStreamError | null;
  throw new HttpError(
    error?.status ?? 500,
    JSON.stringify({
      code: error?.code ?? "BUILD_FAILED",
      message: error?.message ?? "",
    }),
  );
}

export type UndoBuildRequest = InferRequestType<
  BuildClient["undo"]["$post"]
>["json"];
export type UndoBuildResult = InferResponseType<
  BuildClient["undo"]["$post"],
  200
>;
export type UndoBuildRefusal = InferResponseType<
  BuildClient["undo"]["$post"],
  409
>;

/**
 * Reverts an applied plan. A refusal (something changed since, or it was
 * already undone) is an answer, not an error: it changed nothing and says why.
 */
export async function undoBuild(
  body: UndoBuildRequest,
): Promise<
  | { refused: false; result: UndoBuildResult }
  | { refused: true; refusal: UndoBuildRefusal }
> {
  const response = await client.ai.build.undo.$post({ json: body });
  if (response.status === 409) {
    return {
      refused: true,
      refusal: (await response.json()) as UndoBuildRefusal,
    };
  }
  return { refused: false, result: await ok<UndoBuildResult>(response) };
}
